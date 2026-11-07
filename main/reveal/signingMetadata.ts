import { Interface, keccak256 } from 'ethers'
import { setTimeout, clearTimeout } from 'node:timers'

const tokenInterface = new Interface([
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)'
])
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u
const MAX_TOKENS = 32
const READ_TIMEOUT_MS = 4000

type MetadataDependencies = {
  rpc: (chainId: number, method: string, params: unknown[]) => Promise<unknown>
  fetchContract: (
    address: string,
    chainId: number,
    codeHash: string
  ) => Promise<{ name: string; source: string } | undefined>
}

export interface SigningMetadata {
  tokens: Array<{ address: string; chainId: number; decimals?: number; name: string; symbol: string }>
  spender?: { address: string; contractName: string; contractSource: string }
}

async function optionalRead<T>(read: () => Promise<T>): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve().then(read),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), READ_TIMEOUT_MS)
      })
    ])
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

function displayLabel(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  const label = value.trim()
  return label.length <= max && !/[\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(label) ? label : ''
}

// Optional presentation evidence only. Never changes signed amounts or consent.
export async function loadSigningMetadata(
  chainId: number,
  targets: { tokens: string[]; spender?: string },
  dependencies: MetadataDependencies
): Promise<SigningMetadata> {
  const result: SigningMetadata = { tokens: [] }
  if (!Number.isSafeInteger(chainId) || chainId <= 0) return result
  const { rpc, fetchContract } = dependencies
  const tokens = [
    ...new Set(
      targets.tokens.filter((address) => ADDRESS.test(address)).map((address) => address.toLowerCase())
    )
  ].slice(0, MAX_TOKENS)

  const readToken = async (address: string) => {
    const read = (fn: string) =>
      optionalRead(async () => {
        const raw = await rpc(chainId, 'eth_call', [
          { to: address, data: tokenInterface.encodeFunctionData(fn) },
          'latest'
        ])
        if (typeof raw !== 'string') return
        return tokenInterface.decodeFunctionResult(fn, raw)[0] as unknown
      })
    const [rawDecimals, rawSymbol, rawName] = await Promise.all([
      read('decimals'),
      read('symbol'),
      read('name')
    ])
    const decimals =
      typeof rawDecimals === 'bigint' && rawDecimals >= 0n && rawDecimals <= 255n
        ? Number(rawDecimals)
        : undefined
    const symbol = displayLabel(rawSymbol, 24)
    const name = displayLabel(rawName, 120)
    if (decimals === undefined && !symbol && !name) return
    return { address, chainId, ...(decimals !== undefined ? { decimals } : {}), symbol, name }
  }
  const readSpender = async () => {
    if (!targets.spender || !ADDRESS.test(targets.spender)) return
    const address = targets.spender.toLowerCase()
    const code = await optionalRead(() => rpc(chainId, 'eth_getCode', [address, 'latest']))
    if (
      typeof code !== 'string' ||
      !/^0x(?:[0-9a-fA-F]{2})+$/u.test(code) ||
      code.toLowerCase().startsWith('0xef0100')
    )
      return
    const contract = await optionalRead(() => fetchContract(address, chainId, keccak256(code)))
    const name = displayLabel(contract?.name, 120)
    const source = displayLabel(contract?.source, 80)
    return name && source ? { address, contractName: name, contractSource: source } : undefined
  }
  const spender = readSpender()
  // Keep a large Permit2 batch from flooding the configured endpoint.
  for (let offset = 0; offset < tokens.length; offset += 4) {
    const entries = await Promise.all(tokens.slice(offset, offset + 4).map(readToken))
    result.tokens.push(...entries.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)))
  }
  const identity = await spender
  if (identity) result.spender = identity
  return result
}
