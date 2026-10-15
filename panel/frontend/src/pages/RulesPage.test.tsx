import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCloudflareRule } from '../lib/cloudflareRulesApi'
import { placeRule, type CloudflareCustomRule, type RuleDraft } from '../lib/cloudflareRules'
import { RulesPage } from './RulesPage'
import { renderWithProviders } from '../test/renderWithProviders'

const domains = [
  { name: 'app.example.com' },
  { name: 'notes.example.com' },
]

let store: Record<string, CloudflareCustomRule[]>

vi.mock('../lib/domainsApi', () => ({
  fetchDomains: vi.fn(async () => domains),
}))

vi.mock('../lib/cloudflareRulesApi', () => ({
  fetchCloudflareRules: vi.fn(async (domain: string) => ({
    rules: store[domain] ?? [],
    error: null,
  })),
  createCloudflareRule: vi.fn(async (domain: string, draft: RuleDraft) => {
    const rule: CloudflareCustomRule = {
      id: 'rule-new',
      name: draft.name,
      description: draft.description,
      expression: draft.expression,
      action: draft.action,
      enabled: draft.enabled,
      logging: draft.logging,
      skip: draft.skip,
    }
    store[domain] = placeRule(store[domain] ?? [], rule, draft.placement)
    return rule
  }),
  updateCloudflareRule: vi.fn(async (domain: string, ruleId: string, draft: RuleDraft) => {
    const current = store[domain] ?? []
    const rule: CloudflareCustomRule = {
      id: ruleId,
      name: draft.name,
      description: draft.description,
      expression: draft.expression,
      action: draft.action,
      enabled: draft.enabled,
      logging: draft.logging,
      skip: draft.skip,
    }
    store[domain] = placeRule(current, rule, draft.placement)
    return rule
  }),
  deleteCloudflareRule: vi.fn(async (domain: string, ruleId: string) => {
    store[domain] = (store[domain] ?? []).filter((rule) => rule.id !== ruleId)
  }),
}))

function rowFor(name: string) {
  return screen.getByRole('row', { name: new RegExp(name) })
}

describe('RulesPage', () => {
  beforeEach(() => {
    store = {
      'app.example.com': [
        {
          id: 'rule-webhooks',
          name: 'Allow webhooks',
          description: 'URI Path equals /api/strava/webhook',
          expression: 'http.request.uri.path eq "/api/strava/webhook"',
          action: 'skip',
          enabled: true,
          logging: true,
          skip: ['ruleset_current'],
        },
        {
          id: 'rule-oauth',
          name: 'OAuth callbacks',
          description: 'URI Path wildcard r"/api/auth/strava/callback"',
          expression: 'http.request.uri.path wildcard r"/api/auth/strava/callback"',
          action: 'skip',
          enabled: true,
          logging: true,
          skip: ['ruleset_current'],
        },
      ],
      'notes.example.com': [],
    }
  })

  it('shows the rule name and description, and the full expression in the editor', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RulesPage />)

    expect(await screen.findByText('Allow webhooks')).toBeInTheDocument()
    const row = rowFor('Allow webhooks')
    expect(within(row).getByText('URI Path equals /api/strava/webhook')).toBeInTheDocument()
    expect(within(row).queryByText(/http\.request\.uri\.path eq/)).not.toBeInTheDocument()

    await user.click(within(row).getByRole('button', { name: 'Edit' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit rule' })
    expect(within(dialog).getByText('http.request.uri.path eq "/api/strava/webhook"')).toBeInTheDocument()

    const name = within(dialog).getByLabelText('Rule name')
    await user.clear(name)
    await user.type(name, 'Webhook bypass')
    const description = within(dialog).getByLabelText('Description')
    await user.clear(description)
    await user.type(description, 'Strava and Telegram webhooks')
    await user.click(within(dialog).getByRole('button', { name: 'Save rule' }))

    await waitFor(() => {
      expect(screen.getByText('Webhook bypass')).toBeInTheDocument()
    })
    expect(within(rowFor('Webhook bypass')).getByText('Strava and Telegram webhooks')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Rule updated.')
  })

  it('adds a rule in a custom position', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RulesPage />)
    await screen.findByText('Allow webhooks')

    await user.click(screen.getByRole('button', { name: 'Add rule' }))
    const dialog = screen.getByRole('dialog', { name: 'Add rule' })
    await user.type(within(dialog).getByLabelText('Rule name'), 'Block admin')
    await user.type(within(dialog).getByLabelText('Expression'), 'http.request.uri.path eq "/admin"')
    await user.selectOptions(within(dialog).getByLabelText('Action'), 'block')
    await user.selectOptions(within(dialog).getByLabelText('Order'), 'custom')
    await user.selectOptions(within(dialog).getByLabelText('Position'), '2')
    await user.click(within(dialog).getByRole('button', { name: 'Save rule' }))

    await waitFor(() => {
      expect(screen.getByText('Block admin')).toBeInTheDocument()
    })
    const names = screen.getAllByRole('row').map((item) => item.textContent ?? '')
    const adminIndex = names.findIndex((text) => text.includes('Block admin'))
    const webhookIndex = names.findIndex((text) => text.includes('Allow webhooks'))
    expect(adminIndex).toBeGreaterThan(webhookIndex)
  })

  it('sends no skip components when the action is not skip', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RulesPage />)
    await screen.findByText('Allow webhooks')

    await user.click(screen.getByRole('button', { name: 'Add rule' }))
    const dialog = screen.getByRole('dialog', { name: 'Add rule' })
    await user.type(within(dialog).getByLabelText('Rule name'), 'Challenge bots')
    await user.type(within(dialog).getByLabelText('Expression'), 'http.request.uri.path eq "/admin"')
    await user.selectOptions(within(dialog).getByLabelText('Action'), 'managed_challenge')
    await user.click(within(dialog).getByRole('button', { name: 'Save rule' }))

    await waitFor(() => {
      const draft = vi.mocked(createCloudflareRule).mock.calls.at(-1)?.[1]
      expect(draft).toMatchObject({ action: 'managed_challenge', skip: [] })
    })
  })

  it('requires a skip component and confirms delete', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RulesPage />)
    await screen.findByText('Allow webhooks')

    await user.click(within(rowFor('Allow webhooks')).getByRole('button', { name: 'Edit' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit rule' })
    await user.click(within(dialog).getByLabelText('All remaining custom rules'))
    await user.click(within(dialog).getByRole('button', { name: 'Save rule' }))
    expect(screen.getByText('Choose at least one component to skip.')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Delete Allow webhooks' }))
    await user.click(screen.getByRole('button', { name: 'Delete rule' }))
    await waitFor(() => {
      expect(screen.queryByText('Allow webhooks')).not.toBeInTheDocument()
    })
    expect(screen.getByText('OAuth callbacks')).toBeInTheDocument()
  })

  it('shows an empty list for a domain with no rules', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RulesPage />)
    await screen.findByText('Allow webhooks')

    await user.selectOptions(screen.getByLabelText('Domain'), 'notes.example.com')
    expect(await screen.findByText('No custom rules on this domain.')).toBeInTheDocument()
  })
})
