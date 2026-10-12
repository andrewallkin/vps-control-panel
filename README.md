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

## Migration

Step-by-step checklist for moving an existing VPS workload onto a fresh panel install: [docs/migration.md](docs/migration.md).

## Agent API (Plan 2)

Mutating routes are audited; long-running work returns a `job_id` (poll `/v1/jobs`).

- **Jobs** — list jobs, job status, job event stream (`/v1/jobs`)
- **Database** — list databases and roles; create, adopt, drop, detach; rotate and verify passwords; per-slug logical dumps (`/v1/db`, including `/v1/db/dumps/...`)
- **Restore** — chunked upload, complete, status, delete; run restore from an uploaded dump (`/v1/restore/uploads`, `/v1/restore/run`)
- **Backup** — read/update GCS backup settings, test credentials, trigger run-now, status (`/v1/backup/settings`, `/v1/backup/test`, `/v1/backup/run-now`, `/v1/backup/status`)

## Development

```bash
cd agent
uv sync
uv run pytest
uv run ruff format . && uv run ruff check .
```
