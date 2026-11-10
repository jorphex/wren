import TokenLoader from '../externalData/inventory/tokens'
import { YEARN_SYSTEM_TOKENS } from '../yearn/catalog'
import type { SigningMetadata } from './signingMetadata'

type TokenMetadata = SigningMetadata['tokens'][number]
const catalog = new TokenLoader()

// Resolve display metadata without requiring a nonzero holding or a balance scan.
export function knownTokenMetadata(
  chainId: number,
  addresses: string[],
  saved: TokenMetadata[]
): TokenMetadata[] {
  const candidates = [...saved, ...catalog.getTokens([chainId]), ...YEARN_SYSTEM_TOKENS]
  return addresses.flatMap((address) => {
    const matches = candidates.filter(
      (candidate) => candidate.chainId === chainId && candidate.address.toLowerCase() === address
    )
    if (!matches.length) return []
    const decimals = matches
      .map((token) => token.decimals)
      .find((value) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255)
    return [
      {
        address,
        chainId,
        name: matches.find((token) => token.name)?.name || '',
        symbol: matches.find((token) => token.symbol)?.symbol || '',
        ...(decimals !== undefined ? { decimals } : {})
      }
    ]
  })
}
