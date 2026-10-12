// Only allow same-site relative redirects ("/dashboard"), never "//evil.com" or "https://...".
export function safeNext(value: string | null | undefined, fallback = '/dashboard') {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback
  return value
}
