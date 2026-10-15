from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from vpscp_agent.cloudflare import CloudflareClient, CloudflareError
from vpscp_agent.db_ops import NotFoundError

EXPRESSION_LIMIT = 4000
_LABEL_SEP = "\n\n"
_ACTIONS = frozenset({"skip", "block", "managed_challenge", "js_challenge", "challenge"})
_PHASES = {
    "rate_limiting": "http_ratelimit",
    "managed_rules": "http_request_firewall_managed",
    "super_bot_fight": "http_request_sbfm",
}
_PRODUCTS = {
    "zone_lockdown": "zoneLockdown",
    "ua_block": "uaBlock",
    "browser_integrity": "bic",
    "hotlink": "hot",
    "security_level": "securityLevel",
    "rate_limit_legacy": "rateLimit",
    "managed_rules_legacy": "waf",
}
_PHASE_NAMES = {value: key for key, value in _PHASES.items()}
_PRODUCT_NAMES = {value: key for key, value in _PRODUCTS.items()}


class RulePlacement(BaseModel):
    kind: Literal["first", "last", "custom"]
    position: int | None = Field(default=None, ge=1)


class RuleWrite(BaseModel):
    name: str = Field(min_length=1)
    description: str = ""
    expression: str = Field(min_length=1, max_length=EXPRESSION_LIMIT)
    action: str
    enabled: bool = True
    logging: bool = True
    skip: list[str] = Field(default_factory=list)
    placement: RulePlacement


def pack_label(name: str, description: str) -> str:
    name = name.strip()
    description = description.strip()
    if not description:
        return name
    return f"{name}{_LABEL_SEP}{description}"


def unpack_label(stored: str) -> tuple[str, str]:
    if _LABEL_SEP in stored:
        name, description = stored.split(_LABEL_SEP, 1)
        return name.strip(), description.strip()
    return stored.strip(), ""


def _skip_parameters(skip: list[str]) -> dict[str, Any]:
    params: dict[str, Any] = {}
    phases: list[str] = []
    products: list[str] = []
    for item in skip:
        if item == "ruleset_current":
            params["ruleset"] = "current"
        elif item == "phase_current":
            params["phase"] = "current"
        elif item in _PHASES:
            phases.append(_PHASES[item])
        elif item in _PRODUCTS:
            products.append(_PRODUCTS[item])
        else:
            raise ValueError(f"unknown skip component: {item!r}")
    if phases:
        params["phases"] = phases
    if products:
        params["products"] = products
    if not params:
        raise ValueError("choose at least one component to skip")
    return params


def _skip_from_parameters(params: Any) -> list[str]:
    if not isinstance(params, dict):
        return []
    skip: list[str] = []
    if params.get("ruleset") == "current":
        skip.append("ruleset_current")
    if params.get("phase") == "current":
        skip.append("phase_current")
    phases = params.get("phases") or []
    if isinstance(phases, list):
        for phase in phases:
            name = _PHASE_NAMES.get(str(phase))
            if name:
                skip.append(name)
    products = params.get("products") or []
    if isinstance(products, list):
        for product in products:
            name = _PRODUCT_NAMES.get(str(product))
            if name:
                skip.append(name)
    return skip


def rule_from_api(row: dict[str, Any]) -> dict[str, Any]:
    name, description = unpack_label(str(row.get("description") or ""))
    action = str(row.get("action") or "")
    logging = row.get("logging")
    logging_enabled = True
    if isinstance(logging, dict) and "enabled" in logging:
        logging_enabled = bool(logging["enabled"])
    return {
        "id": str(row["id"]),
        "name": name,
        "description": description,
        "expression": str(row.get("expression") or ""),
        "action": action,
        "enabled": bool(row.get("enabled", True)),
        "logging": logging_enabled,
        "skip": _skip_from_parameters(row.get("action_parameters")),
    }


def _validate_write(body: RuleWrite) -> None:
    if body.action not in _ACTIONS:
        raise ValueError(f"unsupported rule action: {body.action!r}")
    if not body.name.strip():
        raise ValueError("enter a rule name")
    if not body.expression.strip():
        raise ValueError("enter an expression")
    if body.action == "skip":
        _skip_parameters(body.skip)
    elif body.skip:
        raise ValueError("skip components apply only to the skip action")


def _index_for(body: RuleWrite, existing_count: int, *, updating: bool) -> int | None:
    placement = body.placement
    if placement.kind == "first":
        return 1
    if placement.kind == "custom":
        if placement.position is None:
            raise ValueError("custom order needs a position")
        limit = existing_count if updating else existing_count + 1
        if placement.position > max(limit, 1):
            raise ValueError("position is past the end of the list")
        return placement.position
    if updating:
        return max(existing_count, 1)
    return None


def rule_to_api(body: RuleWrite, index: int | None) -> dict[str, Any]:
    _validate_write(body)
    payload: dict[str, Any] = {
        "description": pack_label(body.name, body.description),
        "expression": body.expression.strip(),
        "action": body.action,
        "enabled": body.enabled,
    }
    if body.action == "skip":
        payload["action_parameters"] = _skip_parameters(body.skip)
        payload["logging"] = {"enabled": body.logging}
    if index is not None:
        payload["position"] = {"index": index}
    return payload


def _created_rule(result: dict[str, Any], fallback: dict[str, Any]) -> dict[str, Any]:
    rules = result.get("rules")
    if isinstance(rules, list) and rules and isinstance(rules[-1], dict):
        return rule_from_api(rules[-1])
    if result.get("id") and result.get("expression") is not None and result.get("action"):
        return rule_from_api(result)
    if "id" not in fallback:
        raise CloudflareError("unexpected Cloudflare rule response")
    return rule_from_api(fallback)


def list_rules(client: CloudflareClient, zone_id: str) -> dict[str, Any]:
    _ruleset_id, rows, error = client.get_custom_entrypoint(zone_id)
    if error == "permission":
        return {"rules": [], "error": "permission"}
    return {"rules": [rule_from_api(row) for row in rows], "error": None}


def create_rule(client: CloudflareClient, zone_id: str, body: RuleWrite) -> dict[str, Any]:
    ruleset_id, rows, error = client.get_custom_entrypoint(zone_id)
    if error == "permission":
        raise CloudflareError("Zone WAF Edit is required")
    index = _index_for(body, len(rows), updating=False)
    payload = rule_to_api(body, index)
    if ruleset_id is None:
        payload.pop("position", None)
        created = client.create_custom_entrypoint(zone_id, payload)
        return _created_rule(created, payload)
    created = client.add_ruleset_rule(zone_id, ruleset_id, payload)
    return rule_from_api(created)


def update_rule(
    client: CloudflareClient,
    zone_id: str,
    rule_id: str,
    body: RuleWrite,
) -> dict[str, Any]:
    ruleset_id, rows, error = client.get_custom_entrypoint(zone_id)
    if error == "permission":
        raise CloudflareError("Zone WAF Edit is required")
    if ruleset_id is None:
        raise NotFoundError(f"cloudflare rule not found: {rule_id!r}")
    current_index = next(
        (i for i, row in enumerate(rows) if str(row.get("id")) == rule_id), None
    )
    if current_index is None:
        raise NotFoundError(f"cloudflare rule not found: {rule_id!r}")
    index = _index_for(body, len(rows), updating=True)
    if index == current_index + 1:
        index = None
    payload = rule_to_api(body, index)
    updated = client.update_ruleset_rule(zone_id, ruleset_id, rule_id, payload)
    return rule_from_api(updated)


def delete_rule(client: CloudflareClient, zone_id: str, rule_id: str) -> None:
    ruleset_id, rows, error = client.get_custom_entrypoint(zone_id)
    if error == "permission":
        raise CloudflareError("Zone WAF Edit is required")
    if ruleset_id is None or not any(str(row.get("id")) == rule_id for row in rows):
        raise NotFoundError(f"cloudflare rule not found: {rule_id!r}")
    client.delete_ruleset_rule(zone_id, ruleset_id, rule_id)
