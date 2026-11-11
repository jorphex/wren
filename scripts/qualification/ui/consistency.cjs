'use strict'

const checkCommandAffordance = require('./command-affordance.cjs')

// Native-renderer coverage for management controls, panel navigation and initial loading.
// Uses only the isolated qualification fixtures, restoring edited state before capture.
const inspect = async () => {
  const checks = []
  const ensure = (condition, message) => {
    if (!condition) throw new Error(message)
  }
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))
  const tokens = document.querySelector('.customTokensList')
  if (tokens) {
    for (const network of tokens.querySelectorAll('.customTokensListItemChain > div')) {
      ensure(!/^Chain \d+$/.test(network.textContent), 'Token list exposes a raw chain fallback')
    }
    const edit = tokens.querySelector('[aria-label^="Edit "]')
    if (edit) {
      const css = getComputedStyle(edit)
      const neutral = document.createElement('span')
      neutral.style.color = 'var(--wren-text-secondary)'
      edit.parentElement.append(neutral)
      ensure(css.color === getComputedStyle(neutral).color, 'Token edit is not neutral')
      neutral.remove()
    }
    const dialog = tokens.querySelector('[role="alertdialog"]')
    if (dialog) {
      ensure(dialog.querySelector('.wrenControlSecondary'), 'Token removal has no secondary Cancel')
      ensure(dialog.querySelector('.wrenControlDanger'), 'Token removal has no danger commit')
    }
    checks.push('shared token actions')
  }
  const earn = document.querySelector('.earnHero')
  if (earn) {
    ensure(earn.querySelector('h1.wrenScreenReaderOnly'), 'Earn duplicates its visible window heading')
    ensure(earn.querySelector('.earnProvider').getBoundingClientRect().height > 0, 'Earn provider hidden')
    checks.push('Earn heading and provider')
  }
  const tabs = document.querySelector('.networkEditorSections')
  if (tabs) {
    ensure(tabs.getAttribute('role') === 'tablist', 'Network sections lack tablist semantics')
    const buttons = [...tabs.querySelectorAll('[role="tab"]')]
    const initial = buttons.find((button) => button.getAttribute('aria-selected') === 'true')
    const panelMatches = (button) => {
      const panel = document.getElementById(button.getAttribute('aria-controls'))
      ensure(
        button.tabIndex === 0 && panel?.getAttribute('role') === 'tabpanel',
        'Network tab/panel mismatch'
      )
      ensure(panel.getAttribute('aria-labelledby') === button.id, 'Network panel has no tab label')
    }
    panelMatches(initial)
    const key = async (button, value) => {
      button.focus({ preventScroll: true })
      button.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true }))
      await frame()
    }
    await key(initial, 'End')
    panelMatches(buttons[1])
    ensure(document.activeElement === buttons[1], 'End did not focus RPC tab')
    await key(buttons[1], 'ArrowRight')
    panelMatches(buttons[0])
    await key(buttons[0], 'ArrowLeft')
    panelMatches(buttons[1])
    await key(buttons[1], 'Home')
    panelMatches(buttons[0])
    const input = document.querySelector('input[aria-label="Network name"]')
    const original = input.value
    const change = async (value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await frame()
    }
    await change(original + ' edited')
    ensure(buttons[1].disabled, 'Unsaved details did not disable RPC tab')
    await key(buttons[0], 'ArrowRight')
    ensure(buttons[0].getAttribute('aria-selected') === 'true', 'Keyboard bypassed unsaved details')
    await change(original)
    ensure(!buttons[1].disabled, 'Restoring details did not re-enable RPC tab')
    initial.click()
    await frame()
    ensure(buttons.filter((button) => button.tabIndex === 0).length === 1, 'Tablist has multiple Tab stops')
    checks.push('network tabs: associations, arrows, Home/End, unsaved-edit guard')
  }
  const card = document.querySelector('.accountPortfolioCard')
  if (card) {
    const hidden = !!document.querySelector('.accountPrivacyToggleHidden')
    const skeleton = card.querySelector('.accountPortfolioSkeleton')
    const rows = document.querySelectorAll('.balanceLoading')
    if (skeleton) {
      ensure(!hidden && card.getAttribute('aria-busy') === 'true', 'Loading value exposes private state')
      ensure(rows.length === 1, 'Initial loading rows are missing or duplicated')
      ensure(rows[0].querySelectorAll('.balanceLoadingRow').length === 3, 'Loading rows incomplete')
      ensure(getComputedStyle(skeleton).animationName === 'none', 'Loading skeleton animates')
      ensure(
        card.querySelector('.accountPortfolioValue').getAttribute('aria-label') ===
          'Loading portfolio balance',
        'Loading is labeled unavailable'
      )
    }
    if (hidden) ensure(!skeleton && !rows.length, 'Privacy mode shows balance placeholders')
    for (const button of document.querySelectorAll(
      '.accountPrivacyToggle, .accountCopyAddress, .accountWorkspaceToggle'
    )) {
      ensure(
        button.title === button.getAttribute('aria-label'),
        'Tray icon title does not match accessible name'
      )
    }
    checks.push('portfolio loading/privacy and tray icon labels')
  }
  return checks
}

module.exports = async (webContents, fixture) => {
  const affordance = await checkCommandAffordance(webContents)
  const checks = await webContents.executeJavaScript(`(${inspect.toString()})()`, true)
  checks.push(
    ...affordance.commands,
    ...affordance.protectedFlat.map((name) => `${name}: remains contextual`)
  )
  const loading = await webContents.executeJavaScript("!!document.querySelector('.accountPortfolioSkeleton')")
  if (!loading) return checks
  const assert = require('node:assert/strict')
  const original = structuredClone(fixture.main)
  const populated = structuredClone(original)
  const account = fixture.selected.current
  const address = populated.accounts[account].address
  const ids = Object.keys(populated.networks.ethereum)
  populated.accounts[account].balances = { lastUpdated: '2999-01-01T00:00:00.000Z' }
  populated.balances[address] = ids.map((id) => ({
    chainId: Number(id),
    address: '0x0000000000000000000000000000000000000000',
    balance: id === ids[0] ? '1000000000000000000' : '0',
    decimals: 18,
    symbol: 'ETH'
  }))
  populated.networksMeta.ethereum[ids[0]].nativeCurrency.usd = { price: 3200 }
  const replace = async (main) => {
    webContents.send(
      'main:action',
      'stateSync',
      JSON.stringify([
        {
          name: 'qualification-loading-transition',
          count: 1,
          deferred: false,
          updates: [{ path: 'main', value: main }]
        }
      ])
    )
    await webContents.executeJavaScript(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
    )
  }
  const verify = async (expression, message) =>
    assert(await webContents.executeJavaScript(expression), message)
  try {
    await replace(populated)
    await verify(
      "!document.querySelector('.accountPortfolioSkeleton, .balanceLoading')",
      'Loading placeholders survive populated data'
    )
    const value = await webContents.executeJavaScript(
      "document.querySelector('.accountPortfolioValue').textContent"
    )
    assert(value.includes('$') && value !== '—', 'Populated portfolio has no value')
    const cached = structuredClone(populated)
    cached.accounts[account].balances.lastUpdated = '2000-01-01T00:00:00.000Z'
    await replace(cached)
    assert.equal(
      await webContents.executeJavaScript("document.querySelector('.accountPortfolioValue').textContent"),
      value,
      'Refresh hides cached value'
    )
    await verify(
      "!document.querySelector('.balanceLoading') && [...document.querySelectorAll('.balancesPreview .signerBalanceInner')].every(row => getComputedStyle(row).opacity === '1')",
      'Refresh hides cached balances'
    )
    const unavailable = structuredClone(populated)
    unavailable.networksMeta.ethereum[ids[0]].nativeCurrency.usd = {}
    await replace(unavailable)
    await verify(
      "document.querySelector('.accountPortfolioValue').getAttribute('aria-label') === 'Portfolio value unavailable' && !document.querySelector('.accountPortfolioSkeleton, .balanceLoading')",
      'Unavailable value is confused with loading'
    )
  } finally {
    await replace(original)
  }
  await verify("!!document.querySelector('.accountPortfolioSkeleton')", 'Loading fixture was not restored')
  checks.push('loading recovery, cached refresh and unavailable value')
  return checks
}
