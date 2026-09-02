import { Interface } from 'ethers'

const MAX_ARGUMENT_TEXT = 512
const MAX_ARGUMENT_ITEMS = 64

const standardInterface = new Interface([
  'function transfer(address to,uint256 amount)',
  'function transferFrom(address from,address to,uint256 amount)',
  'function approve(address spender,uint256 amount)',
  'function allowance(address owner,address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function deposit() payable',
  'function deposit(uint256 assets,address receiver) returns (uint256 shares)',
  'function mint(uint256 shares,address receiver) returns (uint256 assets)',
  'function withdraw(uint256 amount)',
  'function withdraw(uint256 assets,address receiver,address owner) returns (uint256 shares)',
  'function redeem(uint256 shares,address receiver,address owner) returns (uint256 assets)',
  'function setApprovalForAll(address operator,bool approved)',
  'function safeTransferFrom(address from,address to,uint256 tokenId)',
  'function safeTransferFrom(address from,address to,uint256 tokenId,bytes data)',
  'function safeTransferFrom(address from,address to,uint256 id,uint256 amount,bytes data)',
  'function safeBatchTransferFrom(address from,address to,uint256[] ids,uint256[] amounts,bytes data)',
  'function permit(address owner,address spender,uint256 value,uint256 deadline,uint8 v,bytes32 r,bytes32 s)',
  'function multicall(bytes[] data) returns (bytes[] results)',
  'function execute(address target,uint256 value,bytes data)',
  'function upgradeToAndCall(address newImplementation,bytes data)',
  'function changeAdmin(address newAdmin)',
  'function grantRole(bytes32 role,address account)',
  'function revokeRole(bytes32 role,address account)',
  'function renounceOwnership()',
  'function transferOwnership(address newOwner)'
])

export type LocalCalldataDecode =
  | {
      status: 'decoded'
      source: 'bundled-standard-abi'
      selector: string
      method: string
      signature: string
      arguments: Array<{ name: string; type: string; value: string }>
      truncated?: boolean
    }
  | {
      status: 'unknown' | 'unavailable'
      source: 'bundled-standard-abi'
      selector?: string
      reason: string
    }

function bounded(value: string) {
  return value.length > MAX_ARGUMENT_TEXT ? `${value.slice(0, MAX_ARGUMENT_TEXT - 1)}…` : value
}

function displayValue(value: unknown): { text: string; truncated: boolean } {
  if (Array.isArray(value)) {
    const visible = value.slice(0, MAX_ARGUMENT_ITEMS).map((entry) => displayValue(entry).text)
    return {
      text: bounded(`[${visible.join(', ')}${value.length > visible.length ? ', …' : ''}]`),
      truncated: value.length > visible.length || visible.some((entry) => entry.endsWith('…'))
    }
  }
  if (typeof value === 'bigint') return { text: value.toString(10), truncated: false }
  if (typeof value === 'string') {
    const text = bounded(value)
    return { text, truncated: text !== value }
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    return { text: String(value), truncated: false }
  }
  const text = bounded(String(value))
  return { text, truncated: text.length >= MAX_ARGUMENT_TEXT }
}

export function decodeLocalCalldata(data: string): LocalCalldataDecode {
  if (data === '0x') {
    return {
      status: 'unavailable',
      source: 'bundled-standard-abi',
      reason: 'No function selector is present; a contract fallback may still execute'
    }
  }

  const selector = data.slice(0, 10).toLowerCase()
  if (data.length < 10) {
    return {
      status: 'unavailable',
      source: 'bundled-standard-abi',
      selector,
      reason: 'Calldata is shorter than a function selector'
    }
  }

  try {
    const parsed = standardInterface.parseTransaction({ data })
    if (!parsed) {
      return {
        status: 'unknown',
        source: 'bundled-standard-abi',
        selector,
        reason: "Selector is not in Wren's bundled standard ABI set"
      }
    }

    let truncated = false
    const args = parsed.fragment.inputs.map((input, index) => {
      const displayed = displayValue(parsed.args[index])
      truncated ||= displayed.truncated
      return { name: input.name || `arg${index}`, type: input.type, value: displayed.text }
    })

    return {
      status: 'decoded',
      source: 'bundled-standard-abi',
      selector,
      method: parsed.name,
      signature: parsed.signature,
      arguments: args,
      ...(truncated ? { truncated: true } : {})
    }
  } catch {
    return {
      status: 'unknown',
      source: 'bundled-standard-abi',
      selector,
      reason: "Selector or arguments do not match Wren's bundled standard ABI set"
    }
  }
}
