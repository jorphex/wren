'use strict'

const assert = require('node:assert/strict')

// Runs inside the isolated renderer; do not capture real account or page data.
const measure = () => {
  const nav = document.querySelector('.dashControlNavigation')
  const shelf = document.querySelector('.addressBookAddAction, .customTokensActionShelf')
  const rect = (element) => {
    const { x, y, width, height, bottom, right } = element.getBoundingClientRect()
    return { x, y, width, height, bottom, right }
  }
  if (shelf) {
    const button = shelf.querySelector('button')
    const style = getComputedStyle(button)
    return {
      kind: 'management-shelf',
      secondary: button.classList.contains('wrenControlSecondary'),
      primary: button.classList.contains('wrenControlPrimary'),
      height: rect(shelf).height,
      buttonHeight: rect(button).height,
      padding: style.padding,
      fontSize: style.fontSize,
      fill: style.backgroundColor,
      shadow: style.boxShadow
    }
  }
  if (!nav || (!nav.getClientRects().length && document.querySelector('.earnDetails'))) return null
  const buttons = [...nav.querySelectorAll(':scope > button')]
  const scroller = nav.closest('.dashMainScroll')
  scroller.scrollTop = 0
  const style = getComputedStyle(nav)
  const cells = buttons.map((button) => {
    const css = getComputedStyle(button)
    return {
      label: button.getAttribute('aria-label'),
      current: button.getAttribute('aria-current') === 'page',
      box: rect(button),
      icon: rect(button.querySelector('svg')),
      padding: css.padding,
      fill: css.backgroundColor,
      image: css.backgroundImage,
      border: css.border,
      radius: css.borderRadius,
      shadow: css.boxShadow
    }
  })
  const scrollRange = scroller.scrollHeight - scroller.clientHeight
  // Compare against the previous five-cell grid, then restore before capture.
  const previousNavStyle = nav.getAttribute('style')
  const previousButtonStyles = buttons.map((button) => button.getAttribute('style'))
  buttons[0].style.gridColumn = '1 / -1'
  buttons[1].style.display = 'none'
  const previousScrollRange = scroller.scrollHeight - scroller.clientHeight
  const restore = (element, value) =>
    value === null ? element.removeAttribute('style') : element.setAttribute('style', value)
  restore(nav, previousNavStyle)
  buttons.forEach((button, index) => restore(button, previousButtonStyles[index]))
  const homeContent = [
    ...document.querySelectorAll('.dashToolsCard, .dashCompanion, .dashSupportActions')
  ].map(rect)
  const expected = document.querySelector('.commandHomeIdentity strong, .commandTitle')?.textContent.trim()
  return {
    kind: 'control-grid',
    display: style.display,
    gapX: parseFloat(style.columnGap),
    gapY: parseFloat(style.rowGap),
    cells,
    scrollRange,
    previousScrollRange,
    tools: [...document.querySelectorAll('.dashToolList .dashModuleTitle')].map((node) => node.textContent),
    arrows: nav.querySelectorAll('.dashModuleArrow').length,
    earnOverview: document.querySelector('.dashControlContent > .earn')
      ? rect(document.querySelector('.dashControlContent > .earn'))
      : null,
    earnPadding: document.querySelector('.dashControlContent > .earn')
      ? getComputedStyle(document.querySelector('.dashControlContent > .earn')).padding
      : null,
    scrollOwners: [...document.querySelectorAll('*')]
      .filter(
        (node) =>
          node.clientHeight > 0 &&
          node.scrollHeight > node.clientHeight + 1 &&
          ['auto', 'scroll'].includes(getComputedStyle(node).overflowY)
      )
      .map((node) => (node.classList.contains('dashMainScroll') ? 'dashMainScroll' : node.className)),
    homeContent,
    expected: expected === 'Control' ? 'Home' : expected,
    viewportWidth: innerWidth,
    viewportHeight: innerHeight
  }
}

module.exports = async (webContents) => {
  const result = await webContents.executeJavaScript(`(${measure.toString()})()`)
  if (!result) return null
  if (result.kind === 'management-shelf') {
    assert(result.secondary && !result.primary, 'Management entry action must be secondary')
    assert.equal(result.height, 60)
    assert.equal(result.buttonHeight, 44)
    return result
  }
  const { cells, gapX, gapY } = result
  const order = ['Home', 'Earn', 'Accounts', 'Networks', 'Connected apps', 'Settings']
  const near = (a, b) => assert(Math.abs(a - b) <= 1, `${a} differs from ${b}`)
  assert.equal(result.display, 'grid')
  assert.deepEqual(
    cells.map((cell) => cell.label),
    order
  )
  assert.deepEqual(
    cells.filter((cell) => cell.current).map((cell) => cell.label),
    [result.expected]
  )
  near(gapX, gapY)
  near(gapX, 8)
  for (const cell of cells) {
    near(cell.box.height, 44)
    near(cell.icon.width, 18)
    near(cell.icon.height, 18)
    assert.equal(cell.padding, cells[0].padding)
    assert.equal(cell.radius, cells[0].radius)
  }
  const neutral = cells.filter((cell) => !cell.current)
  for (const cell of neutral)
    for (const key of ['fill', 'image', 'border', 'shadow']) assert.equal(cell[key], neutral[0][key])
  for (const cell of cells) near(cell.box.width, cells[0].box.width)
  assert.equal(result.arrows, 0, 'Primary navigation must not use tool arrows')
  for (const [left, right] of [
    [0, 1],
    [2, 3],
    [4, 5]
  ]) {
    near(cells[left].box.y, cells[right].box.y)
    near(cells[right].box.x - cells[left].box.right, gapX)
    near(cells[left].box.x, cells[0].box.x)
  }
  near(cells[2].box.y - cells[0].box.bottom, gapY)
  near(cells[4].box.y - cells[2].box.bottom, gapY)
  if (result.earnOverview) {
    assert.equal(result.earnPadding, '0px', 'Earn must use the shared shell gutter')
    assert(
      result.scrollOwners.every((owner) => owner === 'dashMainScroll'),
      'Earn has a nested scroll owner'
    )
    near(result.earnOverview.x, cells[0].box.x)
    near(result.earnOverview.right, cells[1].box.right)
  }
  assert.equal(
    result.scrollRange,
    result.previousScrollRange,
    'Promotion changed the previous three-row navigation footprint'
  )
  if (result.homeContent.length) {
    assert.deepEqual(result.tools, ['Contacts', 'Tokens', 'Inspector', 'Contracts'])
    // Full/short standard fixtures must fit. Capped-width fallbacks may retain their
    // existing scroll range (compared above); all content must remain reachable.
    if (result.viewportWidth >= 620 && result.viewportHeight >= 744) {
      assert.equal(result.scrollRange, 0, 'Control home must fit without scrolling')
    }
    for (const box of result.homeContent)
      assert(
        box.y >= 0 && box.bottom <= result.viewportHeight + result.scrollRange,
        'Home content is outside the scrollable viewport'
      )
  }
  for (const cell of [cells.find((candidate) => candidate.current), neutral[0]]) {
    webContents.sendInputEvent({
      type: 'mouseMove',
      x: Math.round(cell.box.x + cell.box.width / 2),
      y: Math.round(cell.box.y + cell.box.height / 2)
    })
    await webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(resolve))`)
    const hovered = await webContents.executeJavaScript(
      `(() => {
        const button = document.querySelectorAll('.dashControlNavigation > button')[${cells.indexOf(cell)}]
        const style = getComputedStyle(button)
        return { fill: style.backgroundColor, image: style.backgroundImage, border: style.border, shadow: style.boxShadow }
      })()`
    )
    for (const key of Object.keys(hovered))
      assert.equal(hovered[key], cell[key], 'Hover adds a third emphasis state')
  }
  webContents.sendInputEvent({ type: 'mouseMove', x: 0, y: 0 })
  result.hoverPreservesEmphasis = true
  await webContents.executeJavaScript(`document.querySelector('.dashControlNavigation button').focus()`)
  for (let index = 0; index < order.length; index++) {
    const active = await webContents.executeJavaScript(`document.activeElement.getAttribute('aria-label')`)
    assert.equal(active, order[index], 'Tab order differs from the visual grid')
    if (index) {
      const ring = await webContents.executeJavaScript(
        `parseFloat(getComputedStyle(document.activeElement).outlineWidth)`
      )
      assert(ring * webContents.getZoomFactor() >= 1.99, `Grid keyboard focus ring is too small: ${ring}px`)
    }
    if (index < order.length - 1) {
      webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' })
      webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' })
      await webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(resolve))`)
    }
  }
  result.keyboardOrder = order
  return result
}
