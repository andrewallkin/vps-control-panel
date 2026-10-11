from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path

from vpscp_agent.validation import validate_env_key, validate_env_value


def _strip_matching_quotes(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    return value


def _parse_kv_line(line: str) -> tuple[str, str] | None:
    if "=" not in line:
        return None
    key, _, raw_value = line.partition("=")
    if not key:
        return None
    try:
        validate_env_key(key)
    except ValueError:
        return None
    return key, _strip_matching_quotes(raw_value)


@dataclass
class _RawSegment:
    line: str


@dataclass
class _KvSegment:
    key: str
    original_line: str
    value: str
    modified: bool = False


@dataclass
class EnvFile:
    _segments: list[_RawSegment | _KvSegment] = field(default_factory=list)
    _appended: list[tuple[str, str]] = field(default_factory=list)

    @classmethod
    def parse(cls, text: str) -> EnvFile:
        env = cls()
        for line in text.splitlines():
            parsed = _parse_kv_line(line)
            if parsed is None:
                env._segments.append(_RawSegment(line))
            else:
                key, value = parsed
                env._segments.append(_KvSegment(key=key, original_line=line, value=value))
        return env

    def get(self, key: str) -> str | None:
        for segment in self._segments:
            if isinstance(segment, _KvSegment) and segment.key == key:
                return segment.value
        for app_key, app_value in self._appended:
            if app_key == key:
                return app_value
        return None

    def keys(self) -> list[str]:
        seen: set[str] = set()
        ordered: list[str] = []
        for segment in self._segments:
            if isinstance(segment, _KvSegment) and segment.key not in seen:
                seen.add(segment.key)
                ordered.append(segment.key)
        for app_key, _ in self._appended:
            if app_key not in seen:
                seen.add(app_key)
                ordered.append(app_key)
        return ordered

    def set_many(self, updates: Mapping[str, str]) -> None:
        for key, value in updates.items():
            validate_env_key(key)
            validate_env_value(value)
            updated = False
            for segment in self._segments:
                if isinstance(segment, _KvSegment) and segment.key == key:
                    segment.value = value
                    segment.modified = True
                    updated = True
                    break
            if not updated:
                for index, (app_key, _) in enumerate(self._appended):
                    if app_key == key:
                        self._appended[index] = (key, value)
                        updated = True
                        break
            if not updated:
                self._appended.append((key, value))

    def unset_many(self, keys: list[str]) -> None:
        for key in keys:
            validate_env_key(key)
        remove = set(keys)
        self._segments = [
            segment
            for segment in self._segments
            if not (isinstance(segment, _KvSegment) and segment.key in remove)
        ]
        self._appended = [(key, value) for key, value in self._appended if key not in remove]

    def render(self) -> str:
        lines: list[str] = []
        for segment in self._segments:
            if isinstance(segment, _RawSegment):
                lines.append(segment.line)
            elif segment.modified:
                lines.append(f"{segment.key}={segment.value}")
            else:
                lines.append(segment.original_line)
        for key, value in self._appended:
            lines.append(f"{key}={value}")
        if not lines:
            return "\n"
        return "\n".join(lines) + "\n"


def read_env(path: Path) -> EnvFile:
    if not path.is_file():
        return EnvFile.parse("")
    return EnvFile.parse(path.read_text())


def write_env_atomic(path: Path, envfile: EnvFile) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.parent / f".{path.name}.tmp.{os.getpid()}"
    fd = os.open(tmp_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w") as handle:
            handle.write(envfile.render())
            handle.flush()
            os.fsync(handle.fileno())
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise
    os.replace(tmp_path, path)
    os.chmod(path, 0o600)
