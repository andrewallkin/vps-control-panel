# shellcheck shell=bash
# Shared helpers for install.sh and update.sh (source from repo root).
append_missing_env_keys() {
  local env_file="$1"
  local example_file="$2"
  local example_line key
  while IFS= read -r example_line || [[ -n "${example_line}" ]]; do
    [[ "${example_line}" =~ ^[A-Z_]+= ]] || continue
    key="${example_line%%=*}"
    if ! grep -q "^${key}=" "${env_file}"; then
      printf '%s\n' "${example_line}" >> "${env_file}"
    fi
  done < <(grep -E '^[A-Z_]+=' "${example_file}")
}
