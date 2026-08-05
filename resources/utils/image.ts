const TRUSTED_REMOTE_IMAGE_HOSTS = new Set(['assets.coingecko.com'])

export function safeRemoteImageUrl(value: unknown) {
  if (typeof value !== 'string' || value.length > 2048) return ''
  try {
    const url = new URL(value)
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      TRUSTED_REMOTE_IMAGE_HOSTS.has(url.hostname.toLowerCase())
      ? url.toString()
      : ''
  } catch {
    return ''
  }
}
