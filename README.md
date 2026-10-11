# vps-control-panel

Self-hosted control panel for a single Ubuntu VPS: central Postgres with GCS backups, per-project databases, nginx + TLS via Cloudflare, Docker Hub deploys, firewall, and resource monitoring.

## Layout

- `agent/` — privileged host agent (root systemd service on a unix socket)
- `stack/` — central Postgres (`postgres-central`) and the GCS backup container
- `install.sh` — bootstraps a fresh Ubuntu 24.04 host (idempotent)

## Install

```bash
git clone git@github.com:andrewallkin/vps-control-panel.git
cd vps-control-panel
sudo ./install.sh
```

`install.sh` installs Docker, nginx, certbot (Cloudflare DNS plugin), and UFW; makes Docker publish container ports on `127.0.0.1` only; allows only SSH, HTTP, and HTTPS; offers SSH hardening; adds swap; installs the agent; and starts the central Postgres stack.

Check the agent:

```bash
sudo curl --unix-socket /run/vpscp/agent.sock http://agent/v1/health
```

## Development

```bash
cd agent
uv sync
uv run pytest
uv run ruff format . && uv run ruff check .
```
