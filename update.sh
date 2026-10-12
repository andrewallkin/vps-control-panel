#!/usr/bin/env bash
# In-place upgrade for an existing vps-control-panel host. Safe to re-run.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "${REPO_DIR}/lib/common.sh"

STACK_DIR=/srv/vpscp/stack
PANEL_DIR=/srv/vpscp/panel
AGENT_DIR=/opt/vpscp/agent
AGENT_SOCKET=/run/vpscp/agent.sock
SYSTEMD_UNIT=/etc/systemd/system/vpscp-agent.service
SNAPSHOT_ROOT=/var/lib/vpscp/update-snapshots

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

require_root() {
  [[ $EUID -eq 0 ]] || die "run with sudo: sudo ./update.sh"
}

parse_args() {
  if [[ $# -eq 0 ]]; then
    return 0
  fi
  [[ $# -eq 1 && "$1" == "--pull" ]] || die "usage: sudo ./update.sh [--pull]"
  git -C "${REPO_DIR}" pull --ff-only
}

agent_curl() {
  curl -fsS --unix-socket "${AGENT_SOCKET}" "$@"
}

warn_inflight_jobs() {
  local jobs_json running
  jobs_json="$(agent_curl http://agent/v1/jobs 2>/dev/null || echo '[]')"
  running="$(jq -r '[.[] | select(.status == "running")] | length' <<<"${jobs_json}" 2>/dev/null || echo 0)"
  if [[ "${running}" != "0" ]]; then
    log "WARNING: ${running} agent job(s) are still running (e.g. a restore)."
    log "Restarting the agent now will kill them and lose their logs. Ctrl-C to abort, or wait."
    sleep 10
  fi
}

snapshot_volumes() {
  # Safety net: a full pre-upgrade snapshot of the panel DB and central
  # Postgres before rebuilding. Restore instructions print on failure.
  local ts
  ts="${SNAPSHOT_ROOT}/$(date -u +%Y%m%dT%H%M%SZ)"
  log "Snapshotting panel_data and pgdata to ${ts}"
  mkdir -p "${ts}"
  docker run --rm -v vpscp_panel_data:/data:ro -v "${ts}:/snap" alpine \
    tar czf /snap/panel_data.tar.gz -C /data . \
    || die "panel_data snapshot failed; aborting upgrade"
  docker exec postgres-central pg_dumpall -U pgadmin | gzip > "${ts}/cluster.sql.gz" \
    || die "pg_dumpall snapshot failed; aborting upgrade"
  chmod 0600 "${ts}/cluster.sql.gz"
  printf '%s\n' "To restore after a bad upgrade:" \
    "  gunzip -c ${ts}/cluster.sql.gz | docker exec -i postgres-central psql -U pgadmin -d postgres" \
    "  docker run --rm -v vpscp_panel_data:/data -v ${ts}:/snap alpine tar xzf /snap/panel_data.tar.gz -C /data" \
    > "${ts}/RESTORE.txt"
  log "Snapshot complete (see ${ts}/RESTORE.txt)"
}

update_agent() {
  log "Updating agent"
  warn_inflight_jobs
  rsync -a --delete --exclude '.venv' --exclude '__pycache__' --exclude '.pytest_cache' \
    --exclude '.ruff_cache' "${REPO_DIR}/agent/" "${AGENT_DIR}/"
  (cd "${AGENT_DIR}" && uv sync --frozen --no-dev)
  local src="${AGENT_DIR}/systemd/vpscp-agent.service"
  if [[ ! -f "${SYSTEMD_UNIT}" ]] || ! cmp -s "${src}" "${SYSTEMD_UNIT}"; then
    install -m 0644 "${src}" "${SYSTEMD_UNIT}"
    systemctl daemon-reload
  fi
  systemctl restart vpscp-agent
}

wait_for_agent_health() {
  local attempt
  for attempt in $(seq 1 30); do
    if curl -fsS --unix-socket "${AGENT_SOCKET}" http://agent/v1/health >/dev/null; then
      return 0
    fi
    [[ "${attempt}" == 30 ]] && die "agent did not become healthy; see: journalctl -u vpscp-agent"
    sleep 1
  done
}

sync_stack_and_panel() {
  log "Syncing stack and panel"
  rsync -a --delete --exclude '.env' --exclude 'panel.env' "${REPO_DIR}/stack/" "${STACK_DIR}/"
  if [[ -f "${STACK_DIR}/.env" && -f "${STACK_DIR}/.env.example" ]]; then
    append_missing_env_keys "${STACK_DIR}/.env" "${STACK_DIR}/.env.example"
  fi
  rsync -a --delete \
    --exclude 'node_modules' --exclude 'dist' --exclude '.venv' --exclude '__pycache__' \
    "${REPO_DIR}/panel/" "${PANEL_DIR}/"
}

refresh_agent_managed_files() {
  log "Refreshing Cloudflare IPs and GitHub known_hosts"
  agent_curl -X POST http://agent/v1/nginx/refresh-cloudflare-ips \
    || die "agent nginx refresh-cloudflare-ips failed"
  agent_curl -X POST http://agent/v1/github/refresh-known-hosts \
    || die "agent github refresh-known-hosts failed"
}

refresh_nginx_base() {
  log "Refreshing nginx base config"
  agent_curl -X POST http://agent/v1/nginx/ensure-base \
    || die "agent nginx ensure-base failed"
}

rebuild_stack() {
  log "Rebuilding panel stack"
  if ! (cd "${STACK_DIR}" && docker compose up -d --build); then
    printf 'error: panel stack rebuild failed (panel DB migrations run at container start).\n' >&2
    printf 'Restore from the pre-upgrade snapshot: see %s/*/RESTORE.txt\n' "${SNAPSHOT_ROOT}" >&2
    printf 'Then re-run: docker compose -f %s/docker-compose.yml up -d --build\n' "${STACK_DIR}" >&2
    exit 1
  fi
}

print_versions() {
  log "Versions"
  local agent_json panel_json attempt
  agent_json="$(agent_curl http://agent/v1/health)"
  echo "Agent version: $(jq -r '.version' <<<"${agent_json}")"
  for attempt in $(seq 1 60); do
    if panel_json="$(curl -fsS http://127.0.0.1:8080/api/health 2>/dev/null)"; then
      echo "Panel version: $(jq -r '.version' <<<"${panel_json}")"
      return 0
    fi
    [[ "${attempt}" == 60 ]] && die "panel did not become healthy; see: docker compose -f ${STACK_DIR}/docker-compose.yml ps"
    sleep 1
  done
}

main() {
  require_root
  parse_args "$@"
  update_agent
  wait_for_agent_health
  sync_stack_and_panel
  snapshot_volumes
  refresh_agent_managed_files
  refresh_nginx_base
  rebuild_stack
  print_versions
  log "Done"
}

main "$@"
