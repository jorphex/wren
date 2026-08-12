export interface PeerConnection {
  close(code?: number, reason?: string): void
  disposeSession(): void
  peerFingerprint?: string
}

const connections = new Map<string, Set<PeerConnection>>()
const cleanup = new Map<string, Set<() => void>>()

export function registerPeerConnection(connection: PeerConnection, fingerprint: string) {
  connection.peerFingerprint = fingerprint
  const peers = connections.get(fingerprint) ?? new Set<PeerConnection>()
  peers.add(connection)
  connections.set(fingerprint, peers)
}

export function unregisterPeerConnection(connection: PeerConnection) {
  if (!connection.peerFingerprint) return
  const peers = connections.get(connection.peerFingerprint)
  peers?.delete(connection)
  if (peers?.size === 0) connections.delete(connection.peerFingerprint)
  delete connection.peerFingerprint
}

export function registerPeerCleanup(fingerprint: string, action: () => void) {
  const actions = cleanup.get(fingerprint) ?? new Set<() => void>()
  actions.add(action)
  cleanup.set(fingerprint, actions)
  return () => {
    actions.delete(action)
    if (actions.size === 0) cleanup.delete(fingerprint)
  }
}

export function disconnectPeer(fingerprint: string, reason = 'Peer credential revoked') {
  const peers = connections.get(fingerprint)
  connections.delete(fingerprint)
  peers?.forEach((connection) => {
    connection.disposeSession()
    connection.close(1008, reason)
  })
  const actions = cleanup.get(fingerprint)
  cleanup.delete(fingerprint)
  actions?.forEach((action) => action())
}

export function resetPeerConnectionsForTests() {
  connections.clear()
  cleanup.clear()
}
