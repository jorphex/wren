import defaultTokenList from './default-tokens.json'

import type { Token } from '../../store/state'

interface TokenSpec extends Token {
  extensions?: {
    omit?: boolean
  }
}

function isBlacklisted(token: TokenSpec) {
  return token.extensions?.omit
}

export default class TokenLoader {
  private readonly tokens: TokenSpec[]

  constructor(tokens: TokenSpec[] = defaultTokenList.tokens as TokenSpec[]) {
    this.tokens = tokens
  }

  async start() {
    return
  }

  stop() {
    return
  }

  getTokens(chains: number[]) {
    return this.tokens.filter((token) => !isBlacklisted(token) && chains.includes(token.chainId))
  }

  getBlacklist(chains: number[] = []) {
    const chainMatches = (token: TokenSpec) => !chains.length || chains.includes(token.chainId)

    return this.tokens.filter((token) => isBlacklisted(token) && chainMatches(token))
  }
}
