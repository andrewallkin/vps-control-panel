export type LoginFieldErrors = {
  username?: string
  password?: string
  code?: string
}

export function validateLoginForm(fields: {
  username: string
  password: string
  code: string
}): LoginFieldErrors {
  const errors: LoginFieldErrors = {}

  if (!fields.username.trim()) {
    errors.username = 'Username is required'
  }
  if (!fields.password) {
    errors.password = 'Password is required'
  }
  if (!fields.code.trim()) {
    errors.code = 'Authentication code is required'
  } else if (!/^\d{6}$/.test(fields.code.trim())) {
    errors.code = 'Code must be exactly 6 digits'
  }

  return errors
}

export function hasLoginFieldErrors(errors: LoginFieldErrors): boolean {
  return Object.keys(errors).length > 0
}
