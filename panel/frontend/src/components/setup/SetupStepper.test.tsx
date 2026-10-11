import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SetupStepper } from './SetupStepper'
import type { SetupStep } from '../../lib/setupApi'

const stepsDomainsPendingCertValid: SetupStep[] = [
  { id: 'account', status: 'done' },
  { id: 'database', status: 'empty' },
  { id: 'cloudflare', status: 'done' },
  { id: 'domains', status: 'pending' },
  { id: 'panel_hostname', status: 'pending' },
]

describe('SetupStepper', () => {
  it('marks only the active step as current when cert is valid but domains status lags', () => {
    const { container } = render(
      <SetupStepper
        active="panel_hostname"
        steps={stepsDomainsPendingCertValid}
        hasValidCert
      />,
    )

    const currentStepIcons = container.querySelectorAll('svg.text-foreground')
    expect(currentStepIcons).toHaveLength(1)

    expect(screen.getByText('Panel hostname').closest('li')?.querySelector('svg.text-foreground')).toBeTruthy()
  })

  it('treats Domains as done when hasValidCert is true', () => {
    render(
      <SetupStepper
        active="panel_hostname"
        steps={stepsDomainsPendingCertValid}
        hasValidCert
      />,
    )

    const domainsLabel = screen.getByText('Domains')
    const domainsItem = domainsLabel.closest('li')
    expect(domainsItem?.querySelector('svg.text-accent')).toBeTruthy()
  })
})
