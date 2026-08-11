'use strict'

const INTERFACE_SCALES = Object.freeze([1, 1.25, 1.5])
const FULL_SHELL_HEIGHT = 900
const SHORT_SHELL_HEIGHT = 744

const COMPACT_TARGET_EXCEPTIONS = Object.freeze([
  {
    selector: '.wrenControlChrome',
    minimum: 24,
    reason: 'Native window chrome is a compact desktop-only control.'
  },
  {
    selector: '.wrenControlCompact',
    minimum: 32,
    reason: 'Explicit compact controls are secondary actions inside dense ledgers.'
  },
  {
    selector: '.wrenControlIcon',
    minimum: 38,
    reason: 'Icon-only shell utilities use the established compact optical target.'
  },
  {
    selector: '.wrenShellNav',
    minimum: 38,
    reason: 'Paired shell navigation controls use the established compact optical target.'
  },
  {
    selector: '.requestFeatureButton',
    minimum: 38,
    reason: 'Control-center support links are a compact tertiary utility row.'
  }
])

const scenarioMatrix = () =>
  INTERFACE_SCALES.flatMap((scale) => [
    {
      id: `tray-empty-full-${scale}`,
      renderer: 'tray',
      state: 'empty',
      scale,
      logicalWidth: 760,
      logicalHeight: FULL_SHELL_HEIGHT,
      ready: '.accountSelectorEmpty'
    },
    {
      id: `tray-empty-short-${scale}`,
      renderer: 'tray',
      state: 'empty',
      scale,
      logicalWidth: 760,
      logicalHeight: SHORT_SHELL_HEIGHT,
      ready: '.accountSelectorEmpty'
    },
    {
      id: `dash-control-center-full-${scale}`,
      renderer: 'dash',
      state: 'control-center',
      scale,
      logicalWidth: 620,
      logicalHeight: FULL_SHELL_HEIGHT,
      ready: '.dashModules'
    },
    {
      id: `dash-control-center-short-${scale}`,
      renderer: 'dash',
      state: 'control-center',
      scale,
      logicalWidth: 620,
      logicalHeight: SHORT_SHELL_HEIGHT,
      ready: '.dashModules'
    },
    {
      id: `onboard-intro-${scale}`,
      renderer: 'onboard',
      state: 'intro',
      scale,
      logicalWidth: 720,
      logicalHeight: 405,
      ready: 'button'
    },
    {
      id: `onboard-access-${scale}`,
      renderer: 'onboard',
      state: 'access',
      scale,
      logicalWidth: 720,
      logicalHeight: 405,
      ready: '[aria-labelledby="onboarding-slide-title"]',
      action: { type: 'clickText', text: 'Get started' }
    }
  ])

const physicalSize = ({ logicalWidth, logicalHeight, scale }) => ({
  width: Math.round(logicalWidth * scale),
  height: Math.round(logicalHeight * scale)
})

module.exports = {
  COMPACT_TARGET_EXCEPTIONS,
  FULL_SHELL_HEIGHT,
  INTERFACE_SCALES,
  SHORT_SHELL_HEIGHT,
  physicalSize,
  scenarioMatrix
}
