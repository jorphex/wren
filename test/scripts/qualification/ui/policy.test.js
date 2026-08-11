/* global require */

const {
  COMPACT_TARGET_EXCEPTIONS,
  INTERFACE_SCALES,
  physicalSize,
  scenarioMatrix
} = require('../../../../scripts/qualification/ui/policy.cjs')
const { fixtureFor, rpcReplyFor } = require('../../../../scripts/qualification/ui/state-fixture.cjs')

it('covers shell, delegation, revocation, and onboarding geometry at every supported scale', () => {
  const scenarios = scenarioMatrix()

  expect(INTERFACE_SCALES).toEqual([1, 1.25, 1.5])
  expect(scenarios).toHaveLength(36)
  for (const scale of INTERFACE_SCALES) {
    expect(scenarios.filter((scenario) => scenario.scale === scale).map((scenario) => scenario.id)).toEqual(
      expect.arrayContaining([
        `tray-empty-full-${scale}`,
        `tray-empty-short-${scale}`,
        `dash-control-center-full-${scale}`,
        `dash-control-center-short-${scale}`,
        `dash-delegation-full-${scale}`,
        `dash-delegation-short-${scale}`,
        `tray-revocation-review-full-${scale}`,
        `tray-revocation-review-short-${scale}`,
        `tray-revocation-monitor-full-${scale}`,
        `tray-revocation-monitor-short-${scale}`,
        `onboard-intro-${scale}`,
        `onboard-access-${scale}`
      ])
    )
  }
})

it('keeps physical bounds and renderer zoom aligned to a stable logical viewport', () => {
  expect(physicalSize({ logicalWidth: 760, logicalHeight: 900, scale: 1 })).toEqual({
    width: 760,
    height: 900
  })
  expect(physicalSize({ logicalWidth: 760, logicalHeight: 900, scale: 1.5 })).toEqual({
    width: 1140,
    height: 1350
  })
})

it('documents each compact target exception with a lower bound and reason', () => {
  expect(COMPACT_TARGET_EXCEPTIONS.length).toBeGreaterThan(0)
  for (const exception of COMPACT_TARGET_EXCEPTIONS) {
    expect(exception.selector).toMatch(/^\./u)
    expect(exception.minimum).toBeGreaterThanOrEqual(24)
    expect(exception.minimum).toBeLessThan(44)
    expect(exception.reason.length).toBeGreaterThan(20)
  }
})

it('injects requested and effective scale without live accounts, networks, or signers', () => {
  const scenario = scenarioMatrix().find(({ scale }) => scale === 1.25)
  const state = fixtureFor(scenario)

  expect(state.main.interfaceScale).toBe(1.25)
  expect(state.view.interfaceScaleEffective).toBe(1.25)
  expect(state.main.accounts).toEqual({})
  expect(state.main.networks.ethereum).toEqual({})
  expect(state.main.signers).toEqual({})
})

it('injects a selected software account and controlled revocation eligibility', () => {
  const scenario = scenarioMatrix().find(({ state, scale }) => state === 'delegation' && scale === 1.25)
  const state = fixtureFor(scenario)

  expect(state.windows.dash.nav).toEqual([{ view: 'accounts', data: {} }])
  expect(state.selected.current).toMatch(/^0x[0-9A-Fa-f]{40}$/u)
  expect(state.main.accounts[state.selected.current]).toMatchObject({
    lastSignerType: 'ring',
    status: 'ok'
  })
  expect(state.main.networks.ethereum[10].connection.endpoints[0].connected).toBe(true)
  expect(rpcReplyFor(scenario, 'getEip7702RevocationEligibility')).toMatchObject({
    status: 'eligible',
    account: state.selected.current,
    chainId: 10
  })
  expect(rpcReplyFor(scenario, 'requestEip7702Revocation')).toBeUndefined()
})

it.each(['revocation-review', 'revocation-monitor'])(
  'injects a long-evidence %s request without signing material',
  (requestState) => {
    const scenario = scenarioMatrix().find(({ state, scale }) => state === requestState && scale === 1)
    const state = fixtureFor(scenario)
    const { accountId, requestId } = state.windows.panel.nav[0].data
    const request = state.main.accounts[accountId].requests[requestId]

    expect(request).toMatchObject({
      type: 'eip7702Revoke',
      version: '1',
      chainId: '0xa',
      payload: {
        id: 1,
        jsonrpc: '2.0',
        method: 'wren_revokeEip7702Delegation',
        params: [accountId, '0xa']
      },
      evidence: {
        source: 'eth_getCode',
        authority: accountId.toLowerCase(),
        delegate: expect.stringMatching(/^0x[0-9A-Fa-f]{40}$/u),
        codeHash: expect.stringMatching(/^0x[0-9a-f]{64}$/u),
        latestNonce: '0x123456789abcdef',
        pendingNonce: '0x123456789abcdef'
      },
      fees: {
        gasLimit: expect.stringMatching(/^0x/u),
        maxFeePerGas: expect.stringMatching(/^0x/u),
        maxPriorityFeePerGas: expect.stringMatching(/^0x/u),
        maxFee: '0x344bc31318000'
      },
      feesUpdatedByUser: false,
      operationVersion: 0
    })
    expect(request).not.toHaveProperty('raw')
    expect(request).not.toHaveProperty('authorization')
    expect(request).not.toHaveProperty('signature')
    expect(requestState === 'revocation-monitor' ? request.submission?.status : undefined).toBe(
      requestState === 'revocation-monitor' ? 'unconfirmed' : undefined
    )
  }
)

it('requires review actions and the safe initial focus for ambiguous monitoring', () => {
  const review = scenarioMatrix().find(({ state, scale }) => state === 'revocation-review' && scale === 1)
  const monitor = scenarioMatrix().find(({ state, scale }) => state === 'revocation-monitor' && scale === 1)

  expect(review.requiredControls).toEqual(['Cancel', 'Revoke delegation', 'Adjust'])
  expect(review.requiredText).toEqual(
    expect.arrayContaining(['Current delegation evidence', 'Maximum execution fee', 'Transaction nonce'])
  )
  expect(monitor).toMatchObject({
    action: { type: 'clickText', text: 'Stop monitoring' },
    expectedInitialFocus: 'Keep monitoring',
    requiredControls: ['Keep monitoring', 'Stop monitoring and continue requests']
  })
})
