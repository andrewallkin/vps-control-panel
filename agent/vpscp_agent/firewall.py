from __future__ import annotations

import ipaddress
import re
from typing import Any

from vpscp_agent.commands import Runner
from vpscp_agent.db_ops import ConflictError
from vpscp_agent.nginx_apply import CloudflareIpFetcher, fetch_cloudflare_ips_cached
from vpscp_agent.state import StateDB

SETTING_CF_ONLY = "firewall_cloudflare_only"
SETTING_PUBLIC_IPV4 = "public_ipv4"

_COMMENT_RE = re.compile(r"^[A-Za-z0-9 _.:-]{0,60}$")
_RULE_LINE_RE = re.compile(
    r"^\[\s*(\d+)\]\s+(.+?)\s+(ALLOW IN|DENY IN)\s+(.+?)(?:\s+#\s*(.*))?\s*$"
)
_TO_PROTO_RE = re.compile(r"^(.+?)/(tcp|udp)(?:\s+\(v6\))?$")
_SS_PROCESS_RE = re.compile(r"users:\(\(\"([^\"]+)\"")

EXPECTED_EXTERNAL_PORTS = frozenset({22, 80, 443})
RESERVED_PORTS = frozenset({5432, 8080})
PUBLIC_BINDS = frozenset({"0.0.0.0", "::", "*"})


def _get_setting(db: StateDB, key: str) -> str | None:
    with db.connect() as conn:
        row = conn.execute("SELECT value FROM agent_setting WHERE key = ?", (key,)).fetchone()
    return None if row is None else str(row["value"])


def _set_setting(db: StateDB, key: str, value: str) -> None:
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO agent_setting (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )


def _cloudflare_only_enabled(db: StateDB) -> bool:
    return _get_setting(db, SETTING_CF_ONLY) == "true"


def list_rules(runner: Runner) -> list[dict[str, Any]]:
    result = runner(["ufw", "status", "numbered"])
    rules: list[dict[str, Any]] = []
    for line in result.stdout.splitlines():
        match = _RULE_LINE_RE.match(line.strip())
        if not match:
            continue
        number = int(match.group(1))
        to_raw = match.group(2).strip()
        action = match.group(3)
        from_raw = match.group(4).strip()
        comment = (match.group(5) or "").strip()
        v6 = "(v6)" in to_raw or "(v6)" in from_raw
        to_clean = to_raw.replace(" (v6)", "").strip()
        proto_match = _TO_PROTO_RE.match(to_clean)
        if not proto_match:
            continue
        to_field = f"{proto_match.group(1)}/{proto_match.group(2)}"
        proto = proto_match.group(2)
        from_field = from_raw.replace(" (v6)", "").strip()
        rules.append(
            {
                "number": number,
                "to": to_field,
                "proto": proto,
                "action": action,
                "from": from_field,
                "v6": v6,
                "comment": comment,
            }
        )
    return rules


def _validate_port(port: int | str) -> str:
    if isinstance(port, str):
        if ":" in port:
            start_s, end_s = port.split(":", 1)
            start, end = int(start_s), int(end_s)
            if start > end:
                raise ValueError(f"invalid port range: {port!r}")
            for value in (start, end):
                if value in RESERVED_PORTS or not 1 <= value <= 65535:
                    raise ValueError(f"invalid port: {value}")
            return port
        value = int(port)
    else:
        value = port
    if value in RESERVED_PORTS or not 1 <= value <= 65535:
        raise ValueError(f"invalid port: {value}")
    return str(value)


def _validate_proto(proto: str) -> str:
    if proto not in ("tcp", "udp"):
        raise ValueError(f"invalid proto: {proto!r}")
    return proto


def _validate_action(action: str) -> str:
    if action not in ("allow", "deny"):
        raise ValueError(f"invalid action: {action!r}")
    return action


def _validate_source(source: str) -> str:
    if source == "any":
        return source
    try:
        if "/" in source:
            ipaddress.ip_network(source, strict=False)
        else:
            ipaddress.ip_address(source)
    except ValueError as exc:
        raise ValueError(f"invalid source: {source!r}") from exc
    return source


def _validate_comment(comment: str) -> str:
    if not _COMMENT_RE.fullmatch(comment):
        raise ValueError(f"invalid comment: {comment!r}")
    return comment


def add_rule(
    runner: Runner,
    *,
    port: int | str,
    proto: str,
    action: str,
    source: str,
    comment: str,
) -> None:
    port_s = _validate_port(port)
    proto_s = _validate_proto(proto)
    action_s = _validate_action(action)
    source_s = _validate_source(source)
    comment_s = _validate_comment(comment)
    runner(
        [
            "ufw",
            action_s,
            "proto",
            proto_s,
            "from",
            source_s,
            "to",
            "any",
            "port",
            port_s,
            "comment",
            comment_s,
        ]
    )


def _rule_matches(rule: dict[str, Any], expected: dict[str, Any]) -> bool:
    for key in ("to", "proto", "action", "from", "v6", "comment"):
        if rule.get(key) != expected.get(key):
            return False
    return True


def _port_from_to(to_field: str) -> int | None:
    port_part = to_field.split("/", 1)[0]
    if ":" in port_part:
        return None
    try:
        return int(port_part)
    except ValueError:
        return None


def _is_web_port_allow(rule: dict[str, Any]) -> bool:
    if rule["action"] != "ALLOW IN":
        return False
    port = _port_from_to(rule["to"])
    return port in (80, 443)


def _is_non_cf_web_port_allow(rule: dict[str, Any]) -> bool:
    return _is_web_port_allow(rule) and rule.get("comment") != "cf"


def _is_ssh_allow_rule(rule: dict[str, Any]) -> bool:
    return (
        rule["action"] == "ALLOW IN" and rule["proto"] == "tcp" and _port_from_to(rule["to"]) == 22
    )


def _validate_client_ip(value: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address:
    try:
        return ipaddress.ip_address(value)
    except ValueError as exc:
        raise ValueError(f"invalid client_ip: {value!r}") from exc


def _is_cf_rule(rule: dict[str, Any]) -> bool:
    return rule.get("comment") == "cf"


def _client_covered_by_ssh(
    rules: list[dict[str, Any]], client_ip: str, *, skip_number: int
) -> bool:
    client = _validate_client_ip(client_ip)
    for rule in rules:
        if rule["number"] == skip_number:
            continue
        if rule["action"] != "ALLOW IN":
            continue
        port = _port_from_to(rule["to"])
        if port != 22 or rule["proto"] != "tcp":
            continue
        if rule["v6"] != (client.version == 6):
            continue
        source = rule["from"]
        if source in ("Anywhere", "Anywhere (v6)"):
            return True
        try:
            if "/" in source:
                network = ipaddress.ip_network(source, strict=False)
                if client in network:
                    return True
            elif ipaddress.ip_address(source) == client:
                return True
        except ValueError:
            continue
    return False


def _check_delete_guardrails(
    db: StateDB,
    rules: list[dict[str, Any]],
    rule: dict[str, Any],
    *,
    client_ip: str | None,
) -> None:
    cf_only = _cloudflare_only_enabled(db)
    if not cf_only and _is_web_port_allow(rule):
        raise ConflictError(f"cannot delete {rule['to']} while Cloudflare-only mode is off")
    if cf_only and _is_cf_rule(rule):
        raise ConflictError(
            "cannot delete individual Cloudflare (cf) rules while Cloudflare-only is on"
        )
    if _is_ssh_allow_rule(rule):
        if not client_ip:
            raise ValueError("client_ip is required to delete an SSH allow rule")
        if not _client_covered_by_ssh(rules, client_ip, skip_number=rule["number"]):
            raise ConflictError(
                f"cannot delete last SSH (22/tcp) rule that allows access from {client_ip}"
            )


def delete_rule(
    runner: Runner,
    *,
    db: StateDB,
    number: int,
    client_ip: str | None,
    expected: dict[str, Any],
    skip_guardrails: bool = False,
) -> None:
    rules = list_rules(runner)
    match = next((r for r in rules if r["number"] == number), None)
    if match is None:
        raise ConflictError(f"firewall rule {number} not found")
    if not _rule_matches(match, expected):
        raise ConflictError(f"rule {number} does not match expected content")
    if not skip_guardrails:
        _check_delete_guardrails(db, rules, match, client_ip=client_ip)
    runner(["ufw", "--force", "delete", str(number)])


def _delete_rules_by_predicate(
    runner: Runner, db: StateDB, predicate, *, client_ip: str | None = None
) -> None:
    for _ in range(512):
        rules = list_rules(runner)
        targets = [r for r in rules if predicate(r)]
        if not targets:
            break
        target = max(targets, key=lambda r: r["number"])
        delete_rule(
            runner,
            db=db,
            number=target["number"],
            client_ip=client_ip,
            expected={
                "to": target["to"],
                "proto": target["proto"],
                "action": target["action"],
                "from": target["from"],
                "v6": target["v6"],
                "comment": target["comment"],
            },
            skip_guardrails=True,
        )
    else:
        raise ConflictError("too many firewall rule deletions in one operation")


def cloudflare_only(
    runner: Runner,
    db: StateDB,
    *,
    on: bool,
    fetch: CloudflareIpFetcher | None = None,
) -> None:
    if on:
        ipv4, ipv6 = fetch_cloudflare_ips_cached(db, fetch=fetch)
        for cidr in ipv4:
            for port in (80, 443):
                add_rule(
                    runner,
                    port=port,
                    proto="tcp",
                    action="allow",
                    source=cidr,
                    comment="cf",
                )
        for cidr in ipv6:
            for port in (80, 443):
                add_rule(
                    runner,
                    port=port,
                    proto="tcp",
                    action="allow",
                    source=cidr,
                    comment="cf",
                )
        _delete_rules_by_predicate(runner, db, _is_non_cf_web_port_allow)
        _set_setting(db, SETTING_CF_ONLY, "true")
    else:
        for port, comment in ((80, "http"), (443, "https")):
            add_rule(runner, port=port, proto="tcp", action="allow", source="any", comment=comment)
        _delete_rules_by_predicate(runner, db, _is_cf_rule)
        _set_setting(db, SETTING_CF_ONLY, "false")


def _is_public_bind(address: str, public_ipv4: str | None) -> bool:
    if address in PUBLIC_BINDS:
        return True
    if public_ipv4 and address == public_ipv4:
        return True
    if address in ("127.0.0.1", "::1"):
        return False
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return False
    return not ip.is_loopback


_INTERNET_WIDE_SOURCES = frozenset({"Anywhere", "0.0.0.0/0", "::/0"})


def _is_internet_wide_source(from_field: str) -> bool:
    return from_field in _INTERNET_WIDE_SOURCES


def _port_matches_to(to_field: str, port: int) -> bool:
    port_part = to_field.split("/", 1)[0]
    if ":" in port_part:
        start_s, end_s = port_part.split(":", 1)
        return int(start_s) <= port <= int(end_s)
    return int(port_part) == port


def _ufw_internet_allowed(rules: list[dict[str, Any]], port: int, proto: str, *, v6: bool) -> bool:
    for rule in sorted(rules, key=lambda item: item["number"]):
        if rule["proto"] != proto or rule["v6"] != v6:
            continue
        if not _port_matches_to(rule["to"], port):
            continue
        if not _is_internet_wide_source(rule["from"]):
            continue
        if rule["action"] == "ALLOW IN":
            return True
        if rule["action"] == "DENY IN":
            return False
    return False


def _parse_ss_local(local: str) -> tuple[str, str] | None:
    if local.startswith("["):
        if "]:" not in local:
            return None
        addr_part, port_s = local.split("]:", 1)
        return addr_part[1:], port_s
    if local.count(":") == 1:
        return local.rsplit(":", 1)
    return None


def _parse_ss_line(line: str, *, proto: str) -> dict[str, Any] | None:
    line = line.strip()
    if not line:
        return None
    local = None
    for token in line.split():
        if token.startswith("[") and "]:" in token:
            local = token
            break
        if token.count(":") == 1 and not token.endswith(":*"):
            _host, port_s = token.rsplit(":", 1)
            if port_s.isdigit() or port_s == "*":
                local = token
                break
    if local is None:
        return None
    process = ""
    proc_match = _SS_PROCESS_RE.search(line)
    if proc_match:
        process = proc_match.group(1)
    parsed_local = _parse_ss_local(local)
    if parsed_local is None:
        return None
    addr, port_s = parsed_local
    if port_s == "*":
        return None
    port = int(port_s)
    v6 = ":" in addr and not addr.startswith("0.0.0.0")
    if addr.startswith("[") and addr.endswith("]"):
        addr = addr[1:-1]
    return {"address": addr, "port": port, "process": process, "proto": proto, "v6": v6}


def exposure_report(runner: Runner, db: StateDB) -> list[dict[str, Any]]:
    public_ipv4 = _get_setting(db, SETTING_PUBLIC_IPV4)
    ufw_rules = list_rules(runner)
    rows: list[dict[str, Any]] = []
    for ss_args, proto in ((["ss", "-H", "-tlnp"], "tcp"), (["ss", "-H", "-ulnp"], "udp")):
        result = runner(ss_args)
        for line in result.stdout.splitlines():
            parsed = _parse_ss_line(line, proto=proto)
            if parsed is None:
                continue
            addr = parsed["address"]
            port = parsed["port"]
            v6 = parsed["v6"]
            public = _is_public_bind(addr, public_ipv4)
            allowed = _ufw_internet_allowed(ufw_rules, port, proto, v6=v6)
            external = public and allowed
            expected = external and port in EXPECTED_EXTERNAL_PORTS
            rows.append(
                {
                    "address": addr,
                    "port": port,
                    "process": parsed["process"],
                    "proto": proto,
                    "external": external,
                    "expected": expected,
                }
            )
    return rows
