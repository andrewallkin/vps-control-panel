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

update_agent() {
  log "Updating agent"
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

rebuild_stack() {
  log "Rebuilding panel stack"
  (cd "${STACK_DIR}" && docker compose up -d --build)
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
  refresh_agent_managed_files
  rebuild_stack
  print_versions
  log "Done"
}

main "$@"
