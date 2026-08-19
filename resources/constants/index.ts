export enum ApprovalType {
  OtherChainApproval = 'approveOtherChain',
  GasLimitApproval = 'approveGasLimit',
  SimulationApproval = 'approveSimulationOverride',
  TokenApprovalRisk = 'approveBroadTokenAuthority',
  TokenAllowanceChangeRisk = 'approveExistingTokenAllowanceChange',
  DelegatedAccountRisk = 'approveDelegatedAccountExecution',
  ProxyImplementationChangeRisk = 'approveProxyImplementationChange',
  TokenPermitRisk = 'approveUnlimitedTokenPermit',
  SignatureRisk = 'approveDangerousSignature',
  DappGuardrailWarning = 'approveDappGuardrailWarning'
}

export const WREN_REPOSITORY_URL = 'https://github.com/jorphex/wren'
export const WREN_LICENSE_URL = `${WREN_REPOSITORY_URL}/blob/main/LICENSE`
export const WREN_SUPPORT_URL = `${WREN_REPOSITORY_URL}/issues`
export const WREN_SUPPORT_ADDRESS = '0x6ac7F5A89E2eC6c30Aa687F9f2117bA1E31D0D97'
export const WREN_COMPANION_RELEASES_URL = 'https://github.com/jorphex/wren-companion/releases'
export const LEDGER_SHOP_URL = 'https://shop.ledger.com/'
export const TREZOR_SHOP_URL = 'https://shop.trezor.io/'

const NETWORK_PRESETS = {
  ethereum: {
    default: {
      local: 'direct'
    },
    1: {
      publicnode: 'https://ethereum-rpc.publicnode.com'
    },
    10: {
      publicnode: 'https://optimism-rpc.publicnode.com'
    },
    137: {
      publicnode: 'https://polygon-bor-rpc.publicnode.com'
    },
    8453: {
      publicnode: 'https://base-rpc.publicnode.com'
    },
    42161: {
      publicnode: 'https://arbitrum-one-rpc.publicnode.com'
    },
    84532: {
      publicnode: 'https://base-sepolia-rpc.publicnode.com'
    },
    11155111: {
      publicnode: 'https://ethereum-sepolia-rpc.publicnode.com'
    },
    11155420: {
      publicnode: 'https://optimism-sepolia-rpc.publicnode.com'
    }
  }
}

const ADDRESS_DISPLAY_CHARS = 8
const NATIVE_CURRENCY = '0x0000000000000000000000000000000000000000'
const MAX_HEX = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'

export { NETWORK_PRESETS, ADDRESS_DISPLAY_CHARS, NATIVE_CURRENCY, MAX_HEX }
