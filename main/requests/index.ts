export { normalizeTransactionChainId } from '../../resources/domain/request/transaction'

const legacyEnvelopeMethods = new Set(['caip_request', 'wallet_request'])

export const isLegacyRequestEnvelope = (method: string) => legacyEnvelopeMethods.has(method)
