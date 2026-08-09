import { Common } from '@ethereumjs/common'
import { EventEmitter } from 'stream'
import type { CallbackProvider } from './optimism'

export interface Chain {
  id: number
  type: 'ethereum'
}

// TODO move this into chains.js when it's converted to TS
declare class Chains extends EventEmitter {
  connections: {
    ethereum: {
      [chainId: string]: {
        chainId: string
        chainConfig: Common
        active?: {
          connected: boolean
          provider?: CallbackProvider | null
        }
        primary?: {
          connected: boolean
          provider?: CallbackProvider | null
        }
        secondary?: {
          connected: boolean
          provider?: CallbackProvider | null
        }
      }
    }
  }

  syncDataEmit(data: unknown): void
  send(payload: JSONRPCRequestPayload, cb: RPCRequestCallback, targetChain?: Chain): void
}

declare const chainConnection: Chains

export default chainConnection
