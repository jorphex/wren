import provider from '../provider'

export type OperationLifecycleRpc = (
  chainId: number,
  method: string,
  params?: readonly unknown[]
) => Promise<unknown>

const RPC_TIMEOUT_MS = 30_000

export const operationLifecycleRpc: OperationLifecycleRpc = (chainId, method, params = []) =>
  new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: Error, value?: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (error) reject(error)
      else resolve(value)
    }
    const timeout = setTimeout(
      () => finish(new Error(`Configured RPC timed out during ${method}`)),
      RPC_TIMEOUT_MS
    )
    timeout.unref?.()

    try {
      provider.connection.send(
        { id: 1, jsonrpc: '2.0', method, params: [...params] },
        (response: RPCResponsePayload) => {
          if (response?.error) {
            finish(new Error(response.error.message || `Configured RPC ${method} failed`))
          } else {
            finish(undefined, response?.result)
          }
        },
        { type: 'ethereum', id: chainId }
      )
    } catch (error) {
      finish(error instanceof Error ? error : new Error(`Configured RPC ${method} failed`))
    }
  })
