/** Typed errors so the UI can react to network / API problems gracefully. */

export class ApiError extends Error {
  status?: number
  retriable: boolean

  constructor(message: string, status?: number, retriable = false) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.retriable = retriable
  }
}

export class RateLimitError extends ApiError {
  constructor(message = 'The content provider is rate limiting requests. Please wait a moment and try again.') {
    super(message, 429, true)
    this.name = 'RateLimitError'
  }
}

export class TimeoutError extends ApiError {
  constructor(message = 'The request timed out. Please check your connection and try again.') {
    super(message, undefined, true)
    this.name = 'TimeoutError'
  }
}

export class ProviderUnavailableError extends ApiError {
  constructor(provider: string) {
    super(`${provider} is currently unavailable. Showing cached or fallback content.`, undefined, true)
    this.name = 'ProviderUnavailableError'
  }
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'Something went wrong. Please try again.'
}
