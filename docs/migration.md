# VPS migration runbook

Checklist for moving from the old single-VPS setup to a new Netcup host running **vps-control-panel**. Work top to bottom; check items off as you go.

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

- [ ] **Cloudflare:** Create an API token with **Zone:Read** and **DNS:Edit** on the zones you will use (**Zone Settings:Read** is optional). Paste it in the wizard; confirm zones list loads.
- [ ] **Domains:** Register **`andrewallkin.cloud`** and **`<new-domain>`** (apex). Wait until at least one certificate shows **valid** before continuing.
- [ ] **Panel hostname:** Choose the FQDN where the control panel itself will live (e.g. `panel.<new-domain>` or a subdomain on `andrewallkin.cloud`). Complete TLS issuance for that hostname.
- [ ] **Docker Hub:** Save registry credentials the host will use to pull private images (username + access token).
- [ ] **Backups:** Configure GCS backup settings:
  - [ ] Bucket name
  - [ ] Service account JSON (upload or paste)
  - [ ] Schedule and **retention** (days)
  - [ ] **Archive passphrase** (for encrypted config archives, if used)
  - [ ] Run **Test credentials** (and optionally **Run now**) once settings look correct.

## 4. Final database cutover on the **old** VPS

Take this dump as late as possible before restore on the new host (minimizes stale data).

- [ ] On the **old** VPS, create the cluster dump:

  ```bash
  docker exec postgres-central pg_dumpall -U pgadmin | gzip > cutover.sql.gz
  ```

- [ ] Copy `cutover.sql.gz` securely to your laptop or straight to the new server (e.g. `scp`).

## 5. Cluster restore on the **new** VPS

- [ ] In the panel, open **Database → Cluster restore**.
- [ ] Upload `cutover.sql.gz` (gzip-compressed `pg_dumpall`).
- [ ] Run restore; watch the job log until it completes.
- [ ] Expect restored DB roles to keep passwords from the dump until you **rotate** per project (below).
- [ ] Confirm `gmail_manager` (and other DBs) appear in the database list; leave `gmail_manager` **unattached**.

## 6. GitHub / CI changes (per app repo)

Do this before or in parallel with panel project creation so deploys push the right images.

### Budget HQ and Strava Automation

- [ ] Add **build + push** workflows modelled on SplitEasy’s `.github/workflows/deploy.yml` (build image, push to Docker Hub, trigger panel deploy or rely on panel polling—match whatever SplitEasy uses today).
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

- [ ] Trigger **Deploy** from the panel (or push a commit that runs the new CI workflow).
- [ ] Confirm containers are **healthy** on the project page.
- [ ] Hit each public hostname over HTTPS; smoke-test login and critical flows.
- [ ] Confirm DNS in Cloudflare points at the **new** IPv4 (via panel upsert).

**Personal site:** serve on **`<new-domain>`** root; configure **`www`** as redirect/alias per wizard hostname rules.

## 10. External integrations

Update third-party URLs that still target the old host:

- [ ] **Strava** webhooks (callback URL host/path).
- [ ] **Telegram** bot webhook URL.
- [ ] **Google OAuth** authorized redirect URIs (and any other OAuth clients).

## 11. Decommission old VPS

- [ ] Keep the **old VPS running for at least 7 days** as rollback insurance (DNS, data, or missed callbacks).
- [ ] After you are confident, power off or delete the old Netcup instance.
- [ ] Optionally drop the restored **`gmail_manager`** database from the panel if you no longer need it (it was never attached to a project).

---

## Quick reference

| Item | Location / command |
|------|-------------------|
| Panel (during setup) | `ssh -L 8080:localhost:8080 user@host` → http://localhost:8080 |
| App data on new host | `/srv/apps/<slug>/data/` |
| Cutover dump (old host) | `docker exec postgres-central pg_dumpall -U pgadmin \| gzip > cutover.sql.gz` |
| Cluster restore | Panel → **Database** → **Cluster restore** |
