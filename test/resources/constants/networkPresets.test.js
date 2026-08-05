import { NETWORK_PRESETS } from '../../../resources/constants'

it('defines the exact PublicNode endpoints for supported built-in networks', () => {
  expect(NETWORK_PRESETS.ethereum).toMatchObject({
    1: { publicnode: 'https://ethereum-rpc.publicnode.com' },
    10: { publicnode: 'https://optimism-rpc.publicnode.com' },
    137: { publicnode: 'https://polygon-bor-rpc.publicnode.com' },
    8453: { publicnode: 'https://base-rpc.publicnode.com' },
    42161: { publicnode: 'https://arbitrum-one-rpc.publicnode.com' },
    84532: { publicnode: 'https://base-sepolia-rpc.publicnode.com' },
    11155111: { publicnode: 'https://ethereum-sepolia-rpc.publicnode.com' },
    11155420: { publicnode: 'https://optimism-sepolia-rpc.publicnode.com' }
  })
  expect(JSON.stringify(NETWORK_PRESETS)).not.toContain('pylon')
})
