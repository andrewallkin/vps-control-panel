const SSH_REPO_RE =
  /^git@github\.com:[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}\.git$/
const HTTPS_REPO_RE =
  /^https:\/\/github\.com\/[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}(\.git)?$/
const BRANCH_RE = /^[A-Za-z0-9._/-]{1,100}$/
const DOCKER_HUB_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

export function validateRepoUrl(url: string): boolean {
  return SSH_REPO_RE.test(url.trim()) || HTTPS_REPO_RE.test(url.trim())
}

export function validateBranch(branch: string): boolean {
  const value = branch.trim()
  if (!value || value.includes('..') || value.startsWith('-')) {
    return false
  }
  return BRANCH_RE.test(value)
}

export function validateDockerHubRepo(repo: string): boolean {
  return DOCKER_HUB_RE.test(repo.trim())
}

export function isSshRepoUrl(url: string): boolean {
  return url.trim().startsWith('git@github.com:')
}
