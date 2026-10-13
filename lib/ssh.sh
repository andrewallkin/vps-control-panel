# shellcheck shell=bash
# SSH key guidance helpers for install.sh.

# Prints ssh-keygen fingerprints for every parseable public key in the
# given authorized_keys file. Returns 1 when the file holds no valid key.
ssh_authorized_keys_fingerprints() {
  local keys="$1" out
  out="$(ssh-keygen -l -f "${keys}" 2>/dev/null)" || return 1
  [[ -n "${out}" ]] || return 1
  printf '%s\n' "${out}"
}

# Prints the accepted keys and the panel tunnel commands for every way a
# user might connect: default-named key, custom-named key, or ssh alias.
ssh_tunnel_hints() {
  local user="$1" host="$2" keys="$3" fps
  if fps="$(ssh_authorized_keys_fingerprints "${keys}")"; then
    printf 'accepted SSH keys for %s:\n' "${user}"
    printf '%s\n' "${fps}" | sed 's/^/  /'
  else
    printf 'no valid SSH public keys in %s\n' "${keys}"
  fi
  printf 'find the matching local key: ssh-keygen -lf ~/.ssh/*.pub\n'
  printf 'panel tunnel - pick the command matching the key you hold:\n'
  printf '  default key:  ssh -L 8080:localhost:8080 %s@%s\n' "${user}" "${host}"
  printf '  custom key:   ssh -L 8080:localhost:8080 -i ~/.ssh/<key> %s@%s\n' "${user}" "${host}"
  printf '  config alias: ssh -L 8080:localhost:8080 <alias>\n'
}
