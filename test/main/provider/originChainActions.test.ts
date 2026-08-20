import {
  applyNetworkRouteRendererAction,
  applyOriginChainRendererAction
} from '../../../main/provider/originChainActions'

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
  connection: { endpoints: [] },
  isTestnet: false,
  explorer: ''
}

const setup = () => {
  const dependencies = {
    getOrigin: jest.fn(() => origin),
    getChain: jest.fn(() => chain),
    rejectUnapprovedRequestsForOriginChain: jest.fn(),
    mutate: jest.fn()
  }
  return dependencies
}

it('rejects old-route work before applying a valid changed origin chain', () => {
  const dependencies = setup()

  expect(applyOriginChainRendererAction([originId, 137, 'ethereum'], dependencies)).toBe(true)
  expect(dependencies.rejectUnapprovedRequestsForOriginChain).toHaveBeenCalledWith(originId, 1)
  expect(dependencies.mutate).toHaveBeenCalledWith(originId, 137, 'ethereum')
  expect(dependencies.rejectUnapprovedRequestsForOriginChain.mock.invocationCallOrder[0]).toBeLessThan(
    dependencies.mutate.mock.invocationCallOrder[0]
  )
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
  expect(dependencies.rejectUnapprovedRequestsForOriginChain).not.toHaveBeenCalled()
  expect(dependencies.mutate).not.toHaveBeenCalled()
})

const networkSetup = () => ({
  getOrigins: jest.fn(() => ({
    [originId]: { ...origin, chain: { id: 137, type: 'ethereum' as const } },
    other: { ...origin, chain: { id: 10, type: 'ethereum' as const } }
  })),
  getNetworks: jest.fn(() => ({ 1: { ...chain, id: 1 }, 137: chain })),
  rejectUnapprovedRequestsForOriginChain: jest.fn(),
  mutate: jest.fn()
})

it.each([
  ['disables a network', 'activateNetwork', ['ethereum', 137, false]],
  ['removes a network', 'removeNetwork', [{ type: 'ethereum', id: 137 }]]
] as const)('%s only after rejecting requests on its old route', (_label, action, args) => {
  const dependencies = networkSetup()

  expect(applyNetworkRouteRendererAction(action, args, dependencies)).toBe(true)
  expect(dependencies.rejectUnapprovedRequestsForOriginChain).toHaveBeenCalledTimes(1)
  expect(dependencies.rejectUnapprovedRequestsForOriginChain).toHaveBeenCalledWith(originId, 137)
  expect(dependencies.rejectUnapprovedRequestsForOriginChain.mock.invocationCallOrder[0]).toBeLessThan(
    dependencies.mutate.mock.invocationCallOrder[0]
  )
})

it('does not reject work while enabling a network', () => {
  const dependencies = networkSetup()
  dependencies.getNetworks.mockReturnValue({ 1: { ...chain, id: 1 }, 137: { ...chain, on: false } })

  expect(applyNetworkRouteRendererAction('activateNetwork', ['ethereum', '137', true], dependencies)).toBe(
    true
  )
  expect(dependencies.rejectUnapprovedRequestsForOriginChain).not.toHaveBeenCalled()
  expect(dependencies.mutate).toHaveBeenCalledWith('ethereum', '137', true)
})

it.each([
  ['already enabled', true, true],
  ['already disabled', false, false]
] as const)('does not reject or mutate when a network is %s', (_label, current, active) => {
  const dependencies = networkSetup()
  dependencies.getNetworks.mockReturnValue({ 1: { ...chain, id: 1 }, 137: { ...chain, on: current } })

  expect(applyNetworkRouteRendererAction('activateNetwork', ['ethereum', 137, active], dependencies)).toBe(
    false
  )
  expect(dependencies.rejectUnapprovedRequestsForOriginChain).not.toHaveBeenCalled()
  expect(dependencies.mutate).not.toHaveBeenCalled()
})

it.each([
  ['missing network', 'activateNetwork', ['ethereum', 10, false]],
  ['mainnet removal', 'removeNetwork', [{ type: 'ethereum', id: 1 }]],
  ['last network removal', 'removeNetwork', [{ type: 'ethereum', id: 137 }]]
] as const)('does not change routes for %s', (_label, action, args) => {
  const dependencies = networkSetup()
  if (_label === 'last network removal') dependencies.getNetworks.mockReturnValue({ 137: chain })

  expect(applyNetworkRouteRendererAction(action, args, dependencies)).toBe(false)
  expect(dependencies.rejectUnapprovedRequestsForOriginChain).not.toHaveBeenCalled()
  expect(dependencies.mutate).not.toHaveBeenCalled()
})
