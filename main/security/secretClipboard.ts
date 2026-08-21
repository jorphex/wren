import crypto from 'crypto'

export const SECRET_CLIPBOARD_TTL_MS = 60_000

type ClipboardAccess = {
  clear: () => void
  readText: () => string
  writeText: (value: string) => void
}

type TimerHandle = ReturnType<typeof setTimeout>

export function createSecretClipboard(
  clipboard: ClipboardAccess,
  {
    ttlMs = SECRET_CLIPBOARD_TTL_MS,
    schedule = setTimeout,
    cancelScheduled = clearTimeout,
    onError = () => {}
  }: {
    ttlMs?: number
    schedule?: (callback: () => void, delay: number) => TimerHandle
    cancelScheduled?: (timer: TimerHandle) => void
    onError?: (error: unknown) => void
  } = {}
) {
  let timer: TimerHandle | undefined
  let pendingFingerprint: Buffer | undefined

  const fingerprint = (value: string) => crypto.createHash('sha256').update(value, 'utf8').digest()

  const clearIfUnchanged = () => {
    const expected = pendingFingerprint
    pendingFingerprint = undefined
    if (!expected) return
    try {
      const current = fingerprint(clipboard.readText())
      if (crypto.timingSafeEqual(current, expected)) clipboard.clear()
    } catch (error) {
      onError(error)
    }
  }

  const cancel = () => {
    if (timer !== undefined) cancelScheduled(timer)
    timer = undefined
    pendingFingerprint = undefined
  }

  const writePublic = (value: string) => {
    clipboard.writeText(value)
    cancel()
  }

  const writeSecret = (secret: string) => {
    const secretFingerprint = fingerprint(secret)
    clipboard.writeText(secret)
    cancel()
    pendingFingerprint = secretFingerprint
    try {
      timer = schedule(() => {
        timer = undefined
        clearIfUnchanged()
      }, ttlMs)
      const scheduledTimer = timer as TimerHandle & { unref?: () => void }
      scheduledTimer.unref?.()
    } catch (error) {
      clearIfUnchanged()
      onError(error)
    }
  }

  const dispose = () => {
    if (timer !== undefined) cancelScheduled(timer)
    timer = undefined
    clearIfUnchanged()
  }

  return { cancel, dispose, writePublic, writeSecret }
}
