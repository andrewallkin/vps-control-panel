export type RuleAction =
  | 'managed_challenge'
  | 'block'
  | 'js_challenge'
  | 'skip'
  | 'challenge'

export type SkipComponent =
  | 'ruleset_current'
  | 'phase_current'
  | 'rate_limiting'
  | 'managed_rules'
  | 'super_bot_fight'
  | 'zone_lockdown'
  | 'ua_block'
  | 'browser_integrity'
  | 'hotlink'
  | 'security_level'
  | 'rate_limit_legacy'
  | 'managed_rules_legacy'

export type RulePlacement =
  | { kind: 'first' }
  | { kind: 'last' }
  | { kind: 'custom'; position: number }

export const EXPRESSION_LIMIT = 4000

export interface CloudflareCustomRule {
  id: string
  name: string
  description: string
  expression: string
  action: RuleAction
  enabled: boolean
  logging: boolean
  skip: SkipComponent[]
}

export interface RuleDraft {
  name: string
  description: string
  expression: string
  action: RuleAction
  enabled: boolean
  logging: boolean
  skip: SkipComponent[]
  placement: RulePlacement
}

export const ACTION_OPTIONS: { value: RuleAction; label: string; hint: string }[] = [
  {
    value: 'skip',
    label: 'Skip',
    hint: 'Skips WAF features or disables specific Cloudflare security products for matching requests.',
  },
  {
    value: 'block',
    label: 'Block',
    hint: 'Blocks matching requests before they reach the origin.',
  },
  {
    value: 'managed_challenge',
    label: 'Managed Challenge',
    hint: 'Presents a challenge chosen by Cloudflare for matching requests.',
  },
  {
    value: 'js_challenge',
    label: 'Non-Interactive Challenge',
    hint: 'Runs a non-interactive browser check for matching requests.',
  },
  {
    value: 'challenge',
    label: 'Interactive Challenge',
    hint: 'Presents an interactive challenge for matching requests.',
  },
]

export const SKIP_OPTIONS: { value: SkipComponent; label: string; group: 'main' | 'more' }[] = [
  { value: 'ruleset_current', label: 'All remaining custom rules', group: 'main' },
  {
    value: 'phase_current',
    label: 'All remaining custom rules in this phase',
    group: 'main',
  },
  { value: 'rate_limiting', label: 'All rate limiting rules', group: 'main' },
  { value: 'managed_rules', label: 'All managed rules', group: 'main' },
  { value: 'super_bot_fight', label: 'All Super Bot Fight Mode rules', group: 'main' },
  { value: 'zone_lockdown', label: 'Zone Lockdown', group: 'more' },
  { value: 'ua_block', label: 'User Agent Blocking', group: 'more' },
  { value: 'browser_integrity', label: 'Browser Integrity Check', group: 'more' },
  { value: 'hotlink', label: 'Hotlink Protection', group: 'more' },
  { value: 'security_level', label: 'Security Level', group: 'more' },
  { value: 'rate_limit_legacy', label: 'Rate limiting rules (previous version)', group: 'more' },
  { value: 'managed_rules_legacy', label: 'Managed rules (previous version)', group: 'more' },
]

export function actionLabel(action: RuleAction): string {
  return ACTION_OPTIONS.find((option) => option.value === action)?.label ?? action
}

function unescapeQuoted(value: string): string {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
}

export function describeExpression(expression: string): string {
  const hits: { index: number; text: string }[] = []
  const collect = (pattern: RegExp, format: (value: string) => string) => {
    for (const match of expression.matchAll(pattern)) {
      if (match.index === undefined || match[1] === undefined) {
        continue
      }
      hits.push({ index: match.index, text: format(match[1]) })
    }
  }
  collect(/http\.request\.uri\.path eq "((?:\\.|[^"\\])*)"/g, (value) => {
    return `URI Path equals ${unescapeQuoted(value)}`
  })
  collect(/starts_with\(http\.request\.uri\.path,\s*"((?:\\.|[^"\\])*)"\)/g, (value) => {
    return `URI Path starts with ${unescapeQuoted(value)}`
  })
  collect(/ends_with\(http\.request\.uri\.path,\s*"((?:\\.|[^"\\])*)"\)/g, (value) => {
    return `URI Path ends with ${unescapeQuoted(value)}`
  })
  collect(/http\.request\.uri\.path contains "((?:\\.|[^"\\])*)"/g, (value) => {
    return `URI Path contains ${unescapeQuoted(value)}`
  })
  collect(/http\.request\.uri\.path wildcard (r?"(?:\\.|[^"\\])*")/g, (value) => {
    return `URI Path wildcard ${value}`
  })
  collect(/ip\.src\.country ne "([^"]*)"/g, (value) => `Country does not equal ${value}`)
  collect(/ip\.src\.country eq "([^"]*)"/g, (value) => `Country equals ${value}`)
  collect(/http\.host eq "((?:\\.|[^"\\])*)"/g, (value) => {
    return `Hostname equals ${unescapeQuoted(value)}`
  })
  hits.sort((left, right) => left.index - right.index)
  if (hits.length === 0) {
    return 'Custom expression'
  }
  return hits.map((hit) => hit.text).join(', ')
}

export function customSlots(otherRules: CloudflareCustomRule[]): { position: number; label: string }[] {
  const count = otherRules.length + 1
  return Array.from({ length: count }, (_, index) => {
    const position = index + 1
    if (position === 1) {
      return { position, label: '1 — first' }
    }
    if (position === count) {
      return { position, label: `${position} — last` }
    }
    const previous = otherRules[position - 2]
    return { position, label: `${position} — after ${previous?.name ?? 'previous rule'}` }
  })
}

export function emptyDraft(): RuleDraft {
  return {
    name: '',
    description: '',
    expression: '',
    action: 'skip',
    enabled: true,
    logging: true,
    skip: ['ruleset_current'],
    placement: { kind: 'first' },
  }
}

export function draftFromRule(rule: CloudflareCustomRule, rules: CloudflareCustomRule[]): RuleDraft {
  const index = rules.findIndex((item) => item.id === rule.id)
  const placement: RulePlacement =
    index <= 0
      ? { kind: 'first' }
      : index === rules.length - 1
        ? { kind: 'last' }
        : { kind: 'custom', position: index + 1 }
  return {
    name: rule.name,
    description: rule.description.trim() || describeExpression(rule.expression),
    expression: rule.expression,
    action: rule.action,
    enabled: rule.enabled,
    logging: rule.logging,
    skip: rule.skip,
    placement,
  }
}

export function placeRule(
  rules: CloudflareCustomRule[],
  rule: CloudflareCustomRule,
  placement: RulePlacement,
): CloudflareCustomRule[] {
  const rest = rules.filter((item) => item.id !== rule.id)
  if (placement.kind === 'first') {
    return [rule, ...rest]
  }
  if (placement.kind === 'last') {
    return [...rest, rule]
  }
  const index = Math.min(Math.max(placement.position, 1), rest.length + 1) - 1
  return [...rest.slice(0, index), rule, ...rest.slice(index)]
}
