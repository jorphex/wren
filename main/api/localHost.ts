const LOCAL_RPC_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

export function isAllowedLocalRpcHost(value: unknown, expectedPort?: number) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) return false

  const match = /^(127\.0\.0\.1|localhost|\[::1\])(?::([0-9]{1,5}))?$/iu.exec(value)
  if (!match || !LOCAL_RPC_HOSTS.has(match[1]!.toLowerCase())) return false

  if (match[2] === undefined) return true

  const port = Number(match[2])
  return port > 0 && port <= 65_535 && (expectedPort === undefined || port === expectedPort)
}
