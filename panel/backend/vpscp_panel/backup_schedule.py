from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from vpscp_panel.routes.dashboard import _parse_schedule_hours


def compute_next_run(
    now: datetime,
    schedule_hours: str,
    schedule_minute: int,
    timezone_name: str,
) -> datetime | None:
    try:
        hours = _parse_schedule_hours(schedule_hours)
    except ValueError:
        return None
    if not hours:
        return None
    try:
        tz = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        return None
    local_now = now.astimezone(tz)
    candidates: list[datetime] = []
    for day_offset in range(3):
        day = local_now.date() + timedelta(days=day_offset)
        for hour in hours:
            candidate = datetime.combine(day, time(hour, schedule_minute), tzinfo=tz)
            if candidate > local_now:
                candidates.append(candidate)
    if not candidates:
        return None
    return min(candidates).astimezone(UTC)
