export enum ApprovalType {
  OtherChainApproval = 'approveOtherChain',
  GasLimitApproval = 'approveGasLimit',
  SimulationApproval = 'approveSimulationOverride',
  TokenApprovalRisk = 'approveBroadTokenAuthority',
  TokenAllowanceChangeRisk = 'approveExistingTokenAllowanceChange',
  DelegatedAccountRisk = 'approveDelegatedAccountExecution',
  ProxyImplementationChangeRisk = 'approveProxyImplementationChange',
  TokenPermitRisk = 'approveUnlimitedTokenPermit',
  SignatureRisk = 'approveDangerousSignature'
}

export const WREN_REPOSITORY_URL = 'https://github.com/jorphex/wren'
export const WREN_LICENSE_URL = `${WREN_REPOSITORY_URL}/blob/main/LICENSE`
export const WREN_SUPPORT_URL = `${WREN_REPOSITORY_URL}/issues/new`
export const WREN_COMPANION_RELEASES_URL = 'https://github.com/jorphex/wren-companion/releases'
export const LEDGER_SHOP_URL = 'https://shop.ledger.com/'
export const TREZOR_SHOP_URL = 'https://shop.trezor.io/'

const NETWORK_PRESETS = {
  ethereum: {
    default: {
      local: 'direct'
    },
    1: {
      pylon: 'wss://evm.pylon.link/mainnet'
    },
    10: {
      pylon: 'wss://evm.pylon.link/optimism'
    },
    137: {
      pylon: 'wss://evm.pylon.link/polygon'
    },
    8453: {
      pylon: 'wss://evm.pylon.link/base-mainnet'
    },
    42161: {
      pylon: 'wss://evm.pylon.link/arbitrum'
    },
    84532: {
      pylon: 'wss://evm.pylon.link/base-sepolia'
    },
    11155111: {
      pylon: 'wss://evm.pylon.link/sepolia'
    },
    11155420: {
      pylon: 'wss://evm.pylon.link/optimism-sepolia'
    }
  }
}

const ADDRESS_DISPLAY_CHARS = 8
const NATIVE_CURRENCY = '0x0000000000000000000000000000000000000000'
const MAX_HEX = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'

export { NETWORK_PRESETS, ADDRESS_DISPLAY_CHARS, NATIVE_CURRENCY, MAX_HEX }
