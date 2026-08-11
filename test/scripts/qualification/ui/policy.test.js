/* global require */

const {
  COMPACT_TARGET_EXCEPTIONS,
  INTERFACE_SCALES,
  physicalSize,
  scenarioMatrix
} = require('../../../../scripts/qualification/ui/policy.cjs')
const { fixtureFor } = require('../../../../scripts/qualification/ui/state-fixture.cjs')

it('covers full and short tray/dashboard geometry plus onboarding at every supported scale', () => {
  const scenarios = scenarioMatrix()

  expect(INTERFACE_SCALES).toEqual([1, 1.25, 1.5])
  expect(scenarios).toHaveLength(18)
  for (const scale of INTERFACE_SCALES) {
    expect(scenarios.filter((scenario) => scenario.scale === scale).map((scenario) => scenario.id)).toEqual(
      expect.arrayContaining([
        `tray-empty-full-${scale}`,
        `tray-empty-short-${scale}`,
        `dash-control-center-full-${scale}`,
        `dash-control-center-short-${scale}`,
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
