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
            # Endpoints passing is not enough: a range whose span covers a
            # reserved port (e.g. "5430:5440" over 5432) must be rejected too.
            for reserved in RESERVED_PORTS:
                if start <= reserved <= end:
                    raise ValueError(f"port range {port!r} spans reserved port {reserved}")
            if start <= 1023:
                raise ValueError(f"port range {port!r} spans privileged ports (<= 1023)")
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
    db: StateDB | None = None,
) -> None:
    port_s = _validate_port(port)
    proto_s = _validate_proto(proto)
    action_s = _validate_action(action)
    source_s = _validate_source(source)
    comment_s = _validate_comment(comment)
    if db is not None and action_s == "allow" and _cloudflare_only_enabled(db):
        web = False
        if ":" in port_s:
            start_s, end_s = port_s.split(":", 1)
            web = int(start_s) <= 80 <= int(end_s) or int(start_s) <= 443 <= int(end_s)
        else:
            web = int(port_s) in (80, 443)
        if web and not _source_is_in_cf_ranges(db, source_s):
            raise ValueError(
                f"source {source_s!r} is not a Cloudflare range: "
                "Cloudflare-only mode only allows 80/443 from Cloudflare IPs"
            )
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
    to_field = rule["to"]
    return _port_matches_to(to_field, 80) or _port_matches_to(to_field, 443)


def _cf_networks(db: StateDB) -> list[ipaddress._BaseNetwork]:
    """Cached Cloudflare ranges; empty when none are known.

    Deliberately reads the cache only (no fetch): classification must not
    have network side effects.
    """
    from vpscp_agent.nginx_apply import SETTING_CF_IPV4, SETTING_CF_IPV6

    nets: list[ipaddress._BaseNetwork] = []
    for key in (SETTING_CF_IPV4, SETTING_CF_IPV6):
        with db.connect() as conn:
            row = conn.execute("SELECT value FROM agent_setting WHERE key = ?", (key,)).fetchone()
        if row is None or not row["value"]:
            continue
        for line in str(row["value"]).splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                nets.append(ipaddress.ip_network(line, strict=False))
            except ValueError:
                continue
    return nets


def _source_is_in_cf_ranges(db: StateDB, source: str) -> bool:
    if source in ("Anywhere", "Anywhere (v6)", "any"):
        return False
    try:
        if "/" in source:
            net = ipaddress.ip_network(source, strict=False)
        else:
            addr = ipaddress.ip_address(source)
            net = ipaddress.ip_network(f"{addr}/{addr.max_prefixlen}", strict=False)
    except ValueError:
        return False
    for cf_net in _cf_networks(db):
        if net.version == cf_net.version and net.subnet_of(cf_net):
            return True
    return False


def _is_cf_rule(db: StateDB, rule: dict[str, Any]) -> bool:
    """A Cloudflare rule is a web-port allow whose source sits inside the
    known Cloudflare ranges. The ufw comment is caller-controlled metadata
    and is never authority."""
    return _is_web_port_allow(rule) and _source_is_in_cf_ranges(db, rule.get("from", ""))


def _is_non_cf_web_port_allow(db: StateDB, rule: dict[str, Any]) -> bool:
    return _is_web_port_allow(rule) and not _is_cf_rule(db, rule)


def _is_ssh_allow_rule(rule: dict[str, Any]) -> bool:
    return (
        rule["action"] == "ALLOW IN" and rule["proto"] == "tcp" and _port_matches_to(rule["to"], 22)
    )


def _validate_client_ip(value: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address:
    try:
        return ipaddress.ip_address(value)
    except ValueError as exc:
        raise ValueError(f"invalid client_ip: {value!r}") from exc


def _client_covered_by_ssh(
    rules: list[dict[str, Any]], client_ip: str, *, skip_number: int
) -> bool:
    client = _validate_client_ip(client_ip)
    for rule in rules:
        if rule["number"] == skip_number:
            continue
        if rule["action"] != "ALLOW IN":
            continue
        if rule["proto"] != "tcp" or not _port_matches_to(rule["to"], 22):
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
    if cf_only and _is_cf_rule(db, rule):
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
        _delete_rules_by_predicate(runner, db, lambda r: _is_non_cf_web_port_allow(db, r))
        _set_setting(db, SETTING_CF_ONLY, "true")
    else:
        # Load CF ranges (cache-hit normally) so the sweep can identify which
        # rules are Cloudflare rules by their source, not their comment.
        fetch_cloudflare_ips_cached(db, fetch=fetch)
        for port, comment in ((80, "http"), (443, "https")):
            add_rule(runner, port=port, proto="tcp", action="allow", source="any", comment=comment)
        _delete_rules_by_predicate(runner, db, lambda r: _is_cf_rule(db, r))
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


def _parse_public_source_network(
    from_field: str,
) -> ipaddress.IPv4Network | ipaddress.IPv6Network | None:
    try:
        if "/" in from_field:
            network = ipaddress.ip_network(from_field, strict=False)
        else:
            if ":" in from_field:
                network = ipaddress.ip_network(f"{from_field}/128", strict=False)
            else:
                network = ipaddress.ip_network(f"{from_field}/32", strict=False)
    except ValueError:
        return None
    if network.is_private or network.is_loopback or network.is_link_local:
        return None
    if isinstance(network, ipaddress.IPv6Network) and network.subnet_of(
        ipaddress.ip_network("fc00::/7")
    ):
        return None
    return network


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
        source = rule["from"]
        if _is_internet_wide_source(source):
            if rule["action"] == "ALLOW IN":
                return True
            if rule["action"] == "DENY IN":
                return False
            continue
        if _parse_public_source_network(source) is None:
            continue
        if rule["action"] == "ALLOW IN":
            return True
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


def _direct_web_exposure(ufw_rules: list[dict[str, Any]], port: int, proto: str, *, v6: bool) -> bool:
    """True when the port is allowed to non-Cloudflare sources (direct exposure)."""
    for rule in ufw_rules:
        if rule["proto"] != proto or rule["v6"] != v6 or rule["action"] != "ALLOW IN":
            continue
        if not _port_matches_to(rule["to"], port):
            continue
        if not _is_cf_source_label(rule.get("from", "")):
            return True
    return False


def _is_cf_source_label(source: str) -> bool:
    """Static helper for report rows: 'is this source one of the CF cidrs' is
    answered with the cached ranges; this variant only rejects the obvious
    internet-wide labels to avoid a db round-trip per row."""
    return source not in ("Anywhere", "Anywhere (v6)", "any")


def exposure_report(runner: Runner, db: StateDB) -> list[dict[str, Any]]:
    public_ipv4 = _get_setting(db, SETTING_PUBLIC_IPV4)
    cf_only = _cloudflare_only_enabled(db)
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
            if cf_only and external and port in (80, 443):
                # Under Cloudflare-only, web traffic must come from CF ranges;
                # direct exposure means the mode is silently false.
                expected = not _direct_web_exposure(ufw_rules, port, proto, v6=v6)
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
