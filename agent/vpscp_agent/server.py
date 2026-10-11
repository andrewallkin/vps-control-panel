import grp
import logging
import os
import socket
from pathlib import Path

import uvicorn

from vpscp_agent.config import load_settings
from vpscp_agent.main import create_app


def bind_socket(path: Path, group: str | None) -> socket.socket:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() or path.is_symlink():
        path.unlink()
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    previous_umask = os.umask(0o117)
    try:
        sock.bind(str(path))
    finally:
        os.umask(previous_umask)
    os.chmod(path, 0o660)
    if group is not None:
        os.chown(path, -1, grp.getgrnam(group).gr_gid)
    return sock


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    settings = load_settings()
    sock = bind_socket(settings.socket_path, settings.socket_group)
    config = uvicorn.Config(create_app(settings), log_level="info", access_log=False)
    uvicorn.Server(config).run(sockets=[sock])


if __name__ == "__main__":
    main()
