#!/usr/bin/env bash
# Unit tests for lib/ssh.sh (SSH key guidance used by install.sh).
# Run: bash tests/test_ssh.sh
set -u

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "${REPO_DIR}/lib/ssh.sh" ]]; then
  # shellcheck source=lib/ssh.sh
  . "${REPO_DIR}/lib/ssh.sh"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

failures=0

assert_eq() {
  local name="$1" want="$2" got="$3"
  if [[ "${want}" == "${got}" ]]; then
    printf 'ok   %s\n' "${name}"
  else
    printf 'FAIL %s\n     want: %s\n     got:  %s\n' "${name}" "${want}" "${got}"
    failures=$((failures + 1))
  fi
}

assert_rc() {
  local name="$1" want="$2" got="$3"
  assert_eq "${name}" "${want}" "${got}"
}

assert_contains() {
  local name="$1" haystack="$2" needle="$3"
  if grep -qF -- "${needle}" <<<"${haystack}"; then
    printf 'ok   %s\n' "${name}"
  else
    printf 'FAIL %s\n     output is missing: %s\n     output: %s\n' "${name}" "${needle}" "${haystack}"
    failures=$((failures + 1))
  fi
}

rc_of() {
  "$@" >/dev/null 2>&1
  echo $?
}

out_of() {
  "$@" 2>/dev/null
}

# --- ssh_authorized_keys_fingerprints ----------------------------------------

ssh-keygen -t ed25519 -N '' -C 'test-key@example' -f "${TMP}/id_test" >/dev/null 2>&1

assert_rc "fingerprints accepts a valid public key" 0 \
  "$(rc_of ssh_authorized_keys_fingerprints "${TMP}/id_test.pub")"
assert_contains "fingerprints names the accepted key" \
  "$(out_of ssh_authorized_keys_fingerprints "${TMP}/id_test.pub")" "test-key@example"

: > "${TMP}/empty_keys"
assert_rc "fingerprints rejects an empty authorized_keys" 1 \
  "$(rc_of ssh_authorized_keys_fingerprints "${TMP}/empty_keys")"

printf '# just a comment\nnot a key at all\n' > "${TMP}/garbage_keys"
assert_rc "fingerprints rejects a file with no parseable keys" 1 \
  "$(rc_of ssh_authorized_keys_fingerprints "${TMP}/garbage_keys")"

# --- ssh_tunnel_hints --------------------------------------------------------

hints="$(out_of ssh_tunnel_hints andrew 203.0.113.5 "${TMP}/id_test.pub")"
assert_contains "hints list the accepted key" "${hints}" "test-key@example"
assert_contains "hints show the default-key tunnel command" "${hints}" \
  "ssh -L 8080:localhost:8080 andrew@203.0.113.5"
assert_contains "hints show the custom-key tunnel command" "${hints}" \
  "ssh -L 8080:localhost:8080 -i ~/.ssh/<key> andrew@203.0.113.5"
assert_contains "hints show the ssh-alias tunnel command" "${hints}" \
  "ssh -L 8080:localhost:8080 <alias>"
assert_contains "hints tell the user how to match a local key" "${hints}" \
  "ssh-keygen -lf ~/.ssh/*.pub"

no_keys="$(out_of ssh_tunnel_hints andrew 203.0.113.5 "${TMP}/garbage_keys")"
assert_contains "hints still show commands when no key is authorized" "${no_keys}" \
  "ssh -L 8080:localhost:8080 andrew@203.0.113.5"

# -----------------------------------------------------------------------------

if [[ "${failures}" -gt 0 ]]; then
  printf '\n%d test(s) failed\n' "${failures}"
  exit 1
fi
printf '\nall tests passed\n'
