import { applyOriginChainRendererAction } from '../../../main/provider/originChainActions'

const originId = '8073729a-5e59-53b7-9e69-5d9bcff94087'
const origin = {
  name: 'example.test',
  chain: { id: 1, type: 'ethereum' as const },
  sessionOnly: false,
  session: { requests: 1, startedAt: 1, lastUpdatedAt: 1 }
}
const chain = {
  id: 137,
  name: 'Polygon',
  on: true,
  connection: { primary: {}, secondary: {} },
  isTestnet: false,
  explorer: ''
}

const setup = () => {
  const dependencies = {
    getOrigin: jest.fn(() => origin),
    getChain: jest.fn(() => chain),
    mutate: jest.fn()
  }
  return dependencies
}

it('applies a valid changed origin chain exactly once', () => {
  const dependencies = setup()

  expect(applyOriginChainRendererAction([originId, 137, 'ethereum'], dependencies)).toBe(true)
  expect(dependencies.mutate).toHaveBeenCalledWith(originId, 137, 'ethereum')
})

it.each([
  ['missing origin', () => undefined, () => chain, 137],
  ['missing chain', () => origin, () => undefined, 137],
  ['disabled chain', () => origin, () => ({ ...chain, on: false }), 137],
  ['unchanged chain', () => origin, () => ({ ...chain, id: 1 }), 1]
])('ignores a %s without mutating state', (_label, getOrigin, getChain, targetId) => {
  const dependencies = setup()
  dependencies.getOrigin.mockImplementation(getOrigin)
  dependencies.getChain.mockImplementation(getChain)

  expect(applyOriginChainRendererAction([originId, targetId, 'ethereum'], dependencies)).toBe(false)
  expect(dependencies.mutate).not.toHaveBeenCalled()
})

it.each([
  ['', 137, 'ethereum'],
  [originId, 0, 'ethereum'],
  [originId, 1.5, 'ethereum'],
  [originId, 137, 'other']
])('rejects malformed renderer arguments without reading state', (...args) => {
  const dependencies = setup()

  expect(applyOriginChainRendererAction(args, dependencies)).toBe(false)
  expect(dependencies.getOrigin).not.toHaveBeenCalled()
  expect(dependencies.getChain).not.toHaveBeenCalled()
  expect(dependencies.mutate).not.toHaveBeenCalled()
})
