const SUBDOMAIN_LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/

export type SubdomainValidationResult =
  | { ok: true; normalized: string }
  | { ok: false; error: string }

export function validateSubdomain(raw: string): SubdomainValidationResult {
  const value = raw.trim().toLowerCase()
  if (value === '') {
    return { ok: true, normalized: '' }
  }
  if (value.includes('.')) {
    return {
      ok: false,
      error: 'Use a single DNS label (no dots). Choose Root for the apex domain.',
    }
  }
  if (!SUBDOMAIN_LABEL_RE.test(value)) {
    return {
      ok: false,
      error:
        'Subdomain must start and end with a letter or digit and use only lowercase letters, digits, and hyphens.',
    }
  }
  return { ok: true, normalized: value }
}

export function buildFqdn(domain: string, subdomain: string): string {
  if (subdomain === '') {
    return domain
  }
  return `${subdomain}.${domain}`
}
