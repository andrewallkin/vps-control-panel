import tarfile
from io import BytesIO
from pathlib import Path

from pyrage import passphrase as pyrage_passphrase

_SOURCES_ROOT = Path("/sources")


def _extra_arcname(path: Path) -> str:
    try:
        return path.relative_to(_SOURCES_ROOT).as_posix()
    except ValueError:
        if path.name == ".env":
            return f"{path.parent.name}/.env"
        return path.name


def _extra_dir_prefix(path: Path) -> str:
    try:
        return path.relative_to(_SOURCES_ROOT).as_posix()
    except ValueError:
        return path.name


def collect_sources(
    apps_root: Path = Path("/sources/apps"),
    extra: list[Path] | None = None,
) -> list[tuple[Path, str]]:
    if extra is None:
        extra = [Path("/sources/stack/.env"), Path("/sources/panel")]
    sources: list[tuple[Path, str]] = []

    if apps_root.is_dir():
        for app_dir in sorted(apps_root.iterdir()):
            if not app_dir.is_dir():
                continue
            slug = app_dir.name
            env_path = app_dir / ".env"
            if env_path.is_file():
                sources.append((env_path, f"apps/{slug}/.env"))
            data_dir = app_dir / "data"
            if data_dir.is_dir():
                for file_path in sorted(data_dir.rglob("*")):
                    if file_path.is_file():
                        rel = file_path.relative_to(data_dir)
                        sources.append(
                            (file_path, f"apps/{slug}/data/{rel.as_posix()}")
                        )

    for path in extra:
        if not path.exists():
            continue
        if path.is_file():
            sources.append((path, _extra_arcname(path)))
        elif path.is_dir():
            prefix = _extra_dir_prefix(path)
            for file_path in sorted(path.rglob("*")):
                if file_path.is_file():
                    rel = file_path.relative_to(path)
                    arcname = f"{prefix}/{rel.as_posix()}"
                    sources.append((file_path, arcname))

    return sources


def build_archive(sources: list[tuple[Path, str]]) -> bytes:
    buffer = BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
        for file_path, arcname in sources:
            archive.add(file_path, arcname=arcname)
    return buffer.getvalue()


def encrypt(data: bytes, passphrase: str) -> bytes:
    return pyrage_passphrase.encrypt(data, passphrase)
