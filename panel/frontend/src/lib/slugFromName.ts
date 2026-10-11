const SLUG_RE = /^[a-z][a-z0-9-]{1,38}$/
const RESERVED_SLUGS = new Set(['panel', 'vpscp-panel', 'vpscp'])

export type SlugResult = { ok: true; slug: string } | { ok: false; error: string }

export function validateProjectSlug(slug: string): SlugResult {
  if (RESERVED_SLUGS.has(slug)) {
    return { ok: false, error: 'reserved slug' }
  }
  if (!SLUG_RE.test(slug)) {
    return { ok: false, error: 'invalid slug' }
  }
  return { ok: true, slug }
}

export function slugFromName(displayName: string): SlugResult {
  const slug = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return validateProjectSlug(slug)
}
