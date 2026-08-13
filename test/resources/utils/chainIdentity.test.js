import fs from 'fs'

import { resolveChainIdentityColor } from '../../../resources/Components/ChainIdentityMark'
import { getChainIdentity } from '../../../resources/utils/chainIdentity'

const chainIdentitySource = fs.readFileSync('resources/Components/ChainIdentityMark/index.js', 'utf8')

test.each([
  [1, 'ethereum', '--wren-chain-ethereum'],
  [10, 'optimism', '--wren-chain-optimism'],
  [100, 'gnosis', '--wren-chain-gnosis'],
  [137, 'polygon', '--wren-chain-polygon'],
  [8453, 'base', '--wren-chain-base'],
  [42161, 'arbitrum', '--wren-chain-arbitrum'],
  [747474, 'katana', '--wren-chain-katana']
])('maps chain %s to its %s identity', (chainId, mark, colorToken) => {
  expect(getChainIdentity(chainId)).toEqual({ mark, colorToken })
})

test('keeps a known testnet mark while using the shared testnet color family', () => {
  expect(getChainIdentity(84532, true)).toEqual({
    mark: 'base',
    colorToken: '--wren-chain-testnet'
  })
})

test('uses a generic network mark and neutral token for unknown chains', () => {
  expect(getChainIdentity(123456)).toEqual({
    mark: 'chain',
    colorToken: '--wren-chain-custom'
  })
})

test('uses authored colors for known chains and the selected color only for custom chains', () => {
  expect(resolveChainIdentityColor(1, false, 'accent8')).toMatchObject({
    color: 'var(--wren-chain-ethereum)',
    custom: false
  })
  expect(resolveChainIdentityColor(123456, false, 'accent8')).toMatchObject({
    color: 'var(--accent8)',
    custom: true
  })
})

test('keeps known chain artwork optically comparable to the generic network mark', () => {
  expect(chainIdentitySource).toMatch(/svgSize=\{identity\.custom \? undefined : small \? 18 : 30\}/)
})
