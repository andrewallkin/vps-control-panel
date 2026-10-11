#!/usr/bin/env bash
# Bootstraps a fresh Ubuntu 24.04 host for vps-control-panel. Safe to re-run.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK_DIR=/srv/vpscp/stack
AGENT_DIR=/opt/vpscp/agent
APPS_DIR=/srv/apps
STATE_DIR=/var/lib/vpscp
AGENT_SOCKET=/run/vpscp/agent.sock
SWAP_SIZE="${VPSCP_SWAP_SIZE:-4G}"
ASSUME_YES="${VPSCP_ASSUME_YES:-0}"

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

require_root() {
  [[ $EUID -eq 0 ]] || die "run with sudo: sudo ./install.sh"
}

require_ubuntu() {
  # shellcheck source=/dev/null
  . /etc/os-release
  [[ "${ID}" == "ubuntu" ]] || die "Ubuntu is required (found ${ID})"
}

install_packages() {
  log "Installing packages"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg jq rsync openssl ufw nginx \
    certbot python3-certbot-dns-cloudflare postgresql-client

  if ! command -v docker >/dev/null 2>&1; then
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    # shellcheck source=/dev/null
    . /etc/os-release
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
      > /etc/apt/sources.list.d/docker.list
    apt-get update -y
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi

  if ! command -v uv >/dev/null 2>&1; then
    curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin UV_NO_MODIFY_PATH=1 sh
  fi
}

configure_docker() {
  log "Configuring Docker: localhost-only published ports, log rotation"
  local desired='{"ip":"127.0.0.1","log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"3"}}'
  local current='{}'
  mkdir -p /etc/docker
  if [[ -s /etc/docker/daemon.json ]]; then
    current="$(cat /etc/docker/daemon.json)"
    if ! jq -e . >/dev/null 2>&1 <<<"${current}"; then
      die "/etc/docker/daemon.json is not valid JSON; fix it before re-running install"
    fi
  fi
  local merged
  merged="$(jq -S -s '.[0] * .[1]' <(printf '%s' "${current}") <(printf '%s' "${desired}"))"
  if [[ "$(jq -S . <<<"${current}")" != "${merged}" ]]; then
    printf '%s\n' "${merged}" > /etc/docker/daemon.json
    systemctl restart docker
  fi
  systemctl enable --now docker
}

configure_firewall() {
  log "Configuring UFW: allow 22, 80, 443 only"
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow 22/tcp comment 'ssh'
  ufw allow 80/tcp comment 'http'
  ufw allow 443/tcp comment 'https'
  ufw --force enable
}

harden_ssh() {
  log "SSH hardening"
  local conf=/etc/ssh/sshd_config.d/10-vpscp.conf
  if [[ -f "${conf}" ]]; then
    echo "already applied (${conf})"
    return
  fi
  local user="${SUDO_USER:-}"
  if [[ -z "${user}" || "${user}" == "root" ]]; then
    echo "skipped: run via sudo from a non-root user so their SSH key can be checked"
    return
  fi
  local keys
  keys="$(getent passwd "${user}" | cut -d: -f6)/.ssh/authorized_keys"
  if [[ ! -s "${keys}" ]]; then
    echo "skipped: ${keys} is empty; add your SSH key first"
    return
  fi
  if [[ "${ASSUME_YES}" != "1" ]]; then
    if [[ ! -t 0 ]]; then
      echo "skipped: not interactive (set VPSCP_ASSUME_YES=1 to apply)"
      return
    fi
    local answer
    read -r -p "Disable root SSH login and password authentication? [y/N] " answer
    [[ "${answer}" =~ ^[Yy]$ ]] || { echo "skipped"; return; }
  fi
  printf 'PermitRootLogin no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\n' > "${conf}"
  sshd -t
  systemctl reload ssh
  echo "applied (${conf})"
}

setup_swap() {
  log "Swap"
  if [[ -n "$(swapon --show --noheadings)" ]]; then
    echo "already present"
    return
  fi
  if [[ ! -f /swapfile ]]; then
    fallocate -l "${SWAP_SIZE}" /swapfile
  fi
  chmod 600 /swapfile
  if ! blkid -o value -s TYPE /swapfile 2>/dev/null | grep -qx swap; then
    if ! file -b /swapfile 2>/dev/null | grep -qi 'swap file'; then
      mkswap /swapfile
    fi
  fi
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "swap active (/swapfile)"
}

setup_directories() {
  log "Directories, group, Docker network"
  getent group vpscp >/dev/null || groupadd --system vpscp
  install -d -m 0755 "${APPS_DIR}" /srv/vpscp /opt/vpscp
  install -d -m 0700 "${STATE_DIR}"
  docker network inspect postgres-net >/dev/null 2>&1 || docker network create postgres-net
}

install_agent() {
  log "Installing agent"
  rsync -a --delete --exclude '.venv' --exclude '__pycache__' --exclude '.pytest_cache' \
    --exclude '.ruff_cache' "${REPO_DIR}/agent/" "${AGENT_DIR}/"
  (cd "${AGENT_DIR}" && uv sync --frozen --no-dev)
  install -m 0644 "${AGENT_DIR}/systemd/vpscp-agent.service" /etc/systemd/system/vpscp-agent.service
  systemctl daemon-reload
  systemctl enable vpscp-agent
  systemctl restart vpscp-agent
}

setup_stack() {
  log "Starting central Postgres and backup stack"
  install -d -m 0750 "${STACK_DIR}"
  rsync -a --delete --exclude '.env' "${REPO_DIR}/stack/" "${STACK_DIR}/"
  if [[ ! -f "${STACK_DIR}/.env" ]]; then
    local password
    password="$(openssl rand -base64 48 | tr -d '/+=\n' | cut -c1-40)"
    (umask 077 && sed "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${password}|" "${STACK_DIR}/.env.example" > "${STACK_DIR}/.env")
    echo "generated ${STACK_DIR}/.env"
  fi
  chown root:root "${STACK_DIR}/.env"
  chmod 600 "${STACK_DIR}/.env"
  (cd "${STACK_DIR}" && docker compose up -d --build)
}

verify() {
  log "Verifying"
  local attempt
  for attempt in $(seq 1 30); do
    if curl -fsS --unix-socket "${AGENT_SOCKET}" http://agent/v1/health; then
      echo
      break
    fi
    [[ "${attempt}" == 30 ]] && die "agent did not become healthy; see: journalctl -u vpscp-agent"
    sleep 1
  done
  (cd "${STACK_DIR}" && docker compose ps)
}

main() {
  require_root
  require_ubuntu
  install_packages
  configure_docker
  configure_firewall
  harden_ssh
  setup_swap
  setup_directories
  install_agent
  setup_stack
  verify
  log "Done"
  echo "Agent socket: ${AGENT_SOCKET}"
  echo "Next: the panel arrives in a later release; for now query the agent with"
  echo "  sudo curl --unix-socket ${AGENT_SOCKET} http://agent/v1/metrics/current"
}

main "$@"
