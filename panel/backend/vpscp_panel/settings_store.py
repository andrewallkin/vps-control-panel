import json
from typing import Any

from sqlalchemy.orm import Session

from vpscp_panel.models import Setting


def get_setting(session: Session, key: str) -> Any | None:
    row = session.get(Setting, key)
    if row is None:
        return None
    return json.loads(row.value_json)


def set_setting(session: Session, key: str, value: Any) -> None:
    encoded = json.dumps(value)
    row = session.get(Setting, key)
    if row is None:
        session.add(Setting(key=key, value_json=encoded))
    else:
        row.value_json = encoded
