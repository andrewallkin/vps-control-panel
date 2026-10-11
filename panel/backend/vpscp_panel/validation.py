import re
from typing import Annotated

from pydantic import AfterValidator

DOMAIN_RE = re.compile(r"^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")
DNS_LABEL_RE = re.compile(r"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$")
_ACME_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def validate_domain(value: str) -> str:
    if not DOMAIN_RE.fullmatch(value):
        raise ValueError(f"invalid domain: {value!r}")
    return value


def validate_subdomain(value: str) -> str:
    if value == "":
        return value
    if not DNS_LABEL_RE.fullmatch(value):
        raise ValueError(f"invalid subdomain: {value!r}")
    return value


def validate_acme_email(value: str | None) -> str | None:
    if value is None:
        return None
    if not _ACME_EMAIL_RE.fullmatch(value):
        raise ValueError(f"invalid acme_email: {value!r}")
    return value


DomainName = Annotated[str, AfterValidator(validate_domain)]
Subdomain = Annotated[str, AfterValidator(validate_subdomain)]
