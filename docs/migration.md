# VPS migration runbook

Checklist for moving from the **old Hostinger VPS** to a **new Netcup** host running **vps-control-panel**. Work top to bottom; check items off as you go.

**In scope:** Budget HQ, Strava Automation, SplitEasy, Health Tracker, personal site.  
**Out of scope:** Run It Up.  
**Note:** A `gmail_manager` database is restored with the cluster dump but is left **unattached** (no project). Delete it manually later if you no longer need it.

Fill in your new apex domain wherever you see `<new-domain>` (do not commit real credentials, tokens, bucket names, or IP addresses into this repo).

---

## 1. New server (Netcup)

- [ ] Order a Netcup VPS with **Ubuntu 24.04** and a **public IPv4** address.
- [ ] Note the root login details from Netcup; connect once as root if needed.
- [ ] Create a **sudo user** with your **SSH public key** in `~/.ssh/authorized_keys` **before** running the panel install (do not rely on password-only root for day-to-day use).
- [ ] Confirm you can `ssh` to the new host as that sudo user with your key.

## 2. Install vps-control-panel

- [ ] Clone this repo on the new host (or copy it), then run:

  ```bash
  cd vps-control-panel
  sudo ./install.sh
  ```

- [ ] Wait until `install.sh` finishes and the agent health check passes.
- [ ] From your **local machine**, open the setup wizard via SSH port forward (replace user and host):

  ```bash
  ssh -L 8080:localhost:8080 <sudo-user>@<new-server-ip>
  ```

  Then browse to **http://localhost:8080** and complete first-time panel admin bootstrap if prompted.

## 3. Panel setup wizard (global)

- [ ] **Database:** you may **Start empty** and continue, or upload a dump directly in the wizard (restore-in-wizard is supported). Either way the final cutover dump is best loaded from **Database → Cluster restore** after setup, as late as possible before go-live. Cluster restore now **refuses a non-empty cluster** unless you tick **Overwrite existing data** — the dialog lists exactly what would be dropped first. A restore that hits errors **fails loudly** instead of reporting success; the wizard shows **Try again** if it does.
- [ ] **Cloudflare:** Create an API token with **Zone:Read** and **DNS:Edit** on the zones you will use (**Zone Settings:Read** is optional). Paste it in the wizard; confirm zones list loads.
- [ ] **ACME email:** the wizard's Cloudflare step collects the Let's Encrypt contact email. Set it **before** registering any domain — certificate issuance fails without it. The same field lives in **Settings → Server** after setup.
- [ ] **Domains:** Register **`andrewallkin.cloud`** and **`<new-domain>`** (apex). Wait until at least one certificate shows **valid** before continuing.
- [ ] **Panel hostname:** Choose the FQDN where the control panel itself will live (e.g. `panel.<new-domain>` or a subdomain on `andrewallkin.cloud`). Complete TLS issuance for that hostname.
- [ ] **Docker Hub:** Save registry credentials the host will use to pull private images (username + access token).
- [ ] **Backups:** Configure GCS backup settings:
  - [ ] Bucket name
  - [ ] Service account JSON (upload or paste)
  - [ ] Schedule and **retention** (days)
  - [ ] **Archive passphrase** (for encrypted config archives, if used)
  - [ ] Run **Test credentials** (and optionally **Run now**) once settings look correct.
- [ ] Finish the wizard and confirm you reach the main dashboard (setup complete).

## 4. Final database cutover on the **old Hostinger** VPS

Take this dump as late as possible before restore on the new Netcup host (minimizes stale data).

- [ ] On the **old Hostinger** VPS, create the cluster dump:

  ```bash
  docker exec postgres-central pg_dumpall -U pgadmin | gzip > cutover.sql.gz
  ```

- [ ] Copy `cutover.sql.gz` securely to your laptop or straight to the new server (e.g. `scp`).

## 5. Cluster restore on the **new Netcup** VPS

Setup must be finished before this step.

- [ ] In the panel, open **Database → Cluster restore** (sidebar **Database** page).
- [ ] Upload `cutover.sql.gz` (gzip-compressed `pg_dumpall`).
- [ ] Run restore; watch the job log until it completes. If the cluster already contains databases (e.g. from a test restore), tick **Overwrite existing data** after reviewing the drop list. Restores fail on any load error except the expected `role "pgadmin" already exists` collision; re-run with overwrite if a previous attempt left objects behind.
- [ ] Expect restored DB roles to keep passwords from the dump until you **rotate** per project (below).
- [ ] Confirm `gmail_manager` (and other DBs) appear in the database list; leave `gmail_manager` **unattached**.

## 6. GitHub / CI changes (per app repo)

Do this before or in parallel with panel project creation so new images land on Docker Hub. **GitHub Actions only build and push images**—you **deploy from the panel** (section 9).

### Budget HQ and Strava Automation

- [ ] Add **build + push** workflows modelled on SplitEasy’s `.github/workflows/deploy.yml` (build image and push to Docker Hub only—no SSH deploy steps).
- [ ] Ensure `docker-compose.yml` (or service compose) uses **`image: ${DOCKER_IMAGE_*}`** for each built service (not hard-coded tags).
- [ ] Remove **`VPS_*`** secrets and **application env secrets** from GitHub Actions; the panel stores deploy/env configuration.

### SplitEasy and Health Tracker

- [ ] Remove legacy deploy steps: **SSH to VPS**, copying **`.env`**, and manual **deploy scripts** from workflows.
- [ ] Rely on panel-managed env and deploy; compose must use **`image: ${DOCKER_IMAGE_*}`** where images are pulled from Docker Hub.
- [ ] Remove **`VPS_*`** and app env secrets from GitHub.

### All in-scope apps

- [ ] Verify no workflow still writes production secrets or SSH keys to the runner for VPS access.

## 7. Create panel projects (one checklist block per app)

Repeat for: **Budget HQ**, **Strava Automation**, **SplitEasy**, **Health Tracker**, **personal site**.

- [ ] **New project** wizard: set slug, compose path, domains/hostnames as on the old setup (personal site: apex **`<new-domain>`** plus **`www` → redirect** to apex or primary host).
- [ ] **Database:** choose **Adopt existing** and select the restored database name from the dump (personal site: **No database** if it had none).
- [ ] After attach, **Rotate** the database password (recommended); update the app only via panel env if needed.
- [ ] **Environment:** paste variables from the old project **`.env`**, but **remove** panel-managed keys (do not paste these—they are injected by the panel):
  - `POSTGRES_HOST`
  - `POSTGRES_PORT`
  - `POSTGRES_DB`
  - `POSTGRES_USER`
  - `POSTGRES_PASSWORD`
  - `DATABASE_URL`
- [ ] Map compose **services** to **Docker Hub** repositories and `DOCKER_IMAGE_*` env vars in the wizard.
- [ ] **Compose ports:** each route in the wizard maps a path to a **port env var** (e.g. `FRONTEND_PORT`, `BACKEND_PORT`). The panel allocates a host port (10000–19999) and writes it into `/srv/apps/<slug>/.env`. Your compose file must bind it, e.g. `ports: ["127.0.0.1:${FRONTEND_PORT}:3000"]` (container port 3000 is whatever your UI listens on). Multi-service projects use one env var per service.
- [ ] **Migrations:** set **Migration service** + **Migration command** in the wizard (or project Settings later), e.g. service `backend`, command `bash /app/run_migrations.sh` (the script must exist inside the image — copy it in the Dockerfile, like SplitEasy's `backend/run_migrations.sh`). The command runs in a one-off container (`docker compose run --rm --no-deps <service> <cmd>`) **after** the image is pulled and **before** containers switch — same order as your old CI's `run_migrations.sh` step, but migrate-before-up so a failed migration keeps the old containers serving. It runs on **every** deploy (checkbox "Run database migrations" is pre-ticked; untick to skip). Notes: no shell features in the command (use `sh -c '…'` if needed), 10-minute job cap, and a standalone **Run migrations** button on the project page runs it without deploying.
- [ ] **DNS:** when you deploy or upsert records from the project, the panel **upserts Cloudflare A records** to the new server’s public IPv4 (no manual A-record edits unless you intentionally adopt foreign records).

## 8. Copy application `data/` directories

For each app that persisted files under `data/` on the old host:

- [ ] Identify the old path (e.g. `/path/to/app/data/` on the old VPS).
- [ ] Rsync to the new layout (panel uses **`/srv/apps/<slug>/data/`**):

  ```bash
  rsync -a <sudo-user>@<old-server>:/path/to/app/data/ <sudo-user>@<new-server>:/srv/apps/<slug>/data/
  ```

- [ ] Fix ownership on the new host if containers fail to read files (`chown` to the UID/GID your compose expects).

## 9. Deploy and verify

For each project:

- [ ] Push commits if needed so CI **builds and pushes** the image to Docker Hub, then trigger **Deploy** from the panel.
- [ ] Confirm containers are **healthy** on the project page.
- [ ] Hit each public hostname over HTTPS; smoke-test login and critical flows.
- [ ] Confirm DNS in Cloudflare points at the **new** IPv4 (via panel upsert).

**Personal site:** serve on **`<new-domain>`** root; configure **`www`** as redirect/alias per wizard hostname rules.

## 10. External integrations

Update third-party URLs that still target the old host:

- [ ] **Strava** webhooks (callback URL host/path).
- [ ] **Telegram** bot webhook URL.
- [ ] **Google OAuth** authorized redirect URIs (and any other OAuth clients).

## 11. Decommission old Hostinger VPS

- [ ] Keep the **old Hostinger VPS running for at least 7 days** as rollback insurance (DNS, data, or missed callbacks).
- [ ] After you are confident, **power off** the Hostinger VPS (the **Netcup** host is your new production server—do not decommission it here).
- [ ] Optionally drop the restored **`gmail_manager`** database from the panel if you no longer need it (it was never attached to a project).

---

## Quick reference

| Item | Location / command |
|------|-------------------|
| Panel (during setup) | `ssh -L 8080:localhost:8080 user@host` → http://localhost:8080 |
| App data on new host | `/srv/apps/<slug>/data/` |
| Cutover dump (old host) | `docker exec postgres-central pg_dumpall -U pgadmin \| gzip > cutover.sql.gz` |
| Cluster restore | Panel → **Database** → **Cluster restore** |
| In-place upgrade | `sudo ./update.sh` (snapshots `pgdata` + `panel_data` to `/var/lib/vpscp/update-snapshots/<ts>/` before rebuilding) |
| Create admin (recovery) | `docker compose exec panel python -m vpscp_panel.cli create-admin <user>` (from `stack/`) |
| Safety dumps | `/var/lib/vpscp/restore/safety-*.sql.gz` — pre-restore snapshots; keep until confident, delete manually |
| Restore errors | Restore jobs fail on load errors; job log shows the failing lines. Re-run with **Overwrite existing data** if a partial restore left objects behind |
| Encrypted backups | When `BACKUP_ARCHIVE_PASSPHRASE` is set, scheduled DB backups upload as `backup_*.sql.gz.age` (age-encrypted). Restore accepts both encrypted and plaintext dumps. |
| Dump safety | A dump is executable code (it runs as the postgres superuser). Only restore dumps you trust; the panel rejects psql meta-commands beyond `\connect`/`\restrict`, `COPY … PROGRAM`, and non-admin `SUPERUSER` grants |
