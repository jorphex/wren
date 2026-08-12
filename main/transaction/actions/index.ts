import type { ActionType as Erc20Actions } from './erc20'
import type { ActionType as EnsActions } from './ens'
import type { ActionType as YearnActions } from './yearn'
import type { AccountRequest } from '../../accounts'

export type EntityType = 'unknown' | 'contract' | 'external'
export type ActionType = Erc20Actions | EnsActions | YearnActions

export type Action<T> = {
  id: ActionType
  data?: T
  update?: (request: AccountRequest, params: Partial<T>) => boolean
}

type DecodeContext = {
  account?: Address
}

type DecodeFunction = (calldata: string, context?: DecodeContext) => Action<unknown> | undefined

export interface DecodableContract {
  name: string
  address: Address
  chainId: number
  decode: DecodeFunction
}
