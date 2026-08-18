// User-visible outcomes resolve at the first canonical receipt. This depth is
// only the bounded background fallback for endpoints whose finalized head does
// not cover the receipt first.
export const BACKGROUND_SETTLEMENT_FALLBACK_CONFIRMATIONS = 13n
