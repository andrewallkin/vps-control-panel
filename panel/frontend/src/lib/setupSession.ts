const CLOUDFLARE_PENDING_KEY = 'vpscp:setup:cloudflareContinuePending'
const PANEL_HOSTNAME_PENDING_KEY = 'vpscp:setup:panelHostnameContinuePending'

export function isCloudflareContinuePending(): boolean {
  return sessionStorage.getItem(CLOUDFLARE_PENDING_KEY) === '1'
}

export function setCloudflareContinuePending(pending: boolean): void {
  if (pending) {
    sessionStorage.setItem(CLOUDFLARE_PENDING_KEY, '1')
  } else {
    sessionStorage.removeItem(CLOUDFLARE_PENDING_KEY)
  }
}

export function getPanelHostnameContinuePending(): string | null {
  return sessionStorage.getItem(PANEL_HOSTNAME_PENDING_KEY)
}

export function setPanelHostnameContinuePending(hostname: string | null): void {
  if (hostname) {
    sessionStorage.setItem(PANEL_HOSTNAME_PENDING_KEY, hostname)
  } else {
    sessionStorage.removeItem(PANEL_HOSTNAME_PENDING_KEY)
  }
}
