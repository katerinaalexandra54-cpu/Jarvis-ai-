// Provider-neutral errors. The UI only ever checks for these, never for a specific vendor.
export class NoKeyError extends Error {
  constructor(message = 'Add your API key to continue.') { super(message); this.name = 'NoKeyError'; }
}
export class ProviderError extends Error {
  constructor(message, { status = 0 } = {}) { super(message); this.name = 'ProviderError'; this.status = status; }
}
export class NetworkError extends ProviderError {
  constructor(message = 'No connection. Check your internet and try again.') { super(message); this.name = 'NetworkError'; }
}
