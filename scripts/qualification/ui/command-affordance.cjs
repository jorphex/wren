'use strict'

const assert = require('node:assert/strict')

// Inspect the rendered command context, not the class used to implement it.
const commands = () => {
  const targets = new Set(
    document.querySelectorAll(
      '.customTokensListItemBottom button, .tokenApprovalsToolbar button, .addressBookTransfer button, ' +
        '.hardwareSignerPromptDismiss, .sendConfirmedActions button, .activityClearButton, ' +
        '.contractVerificationDirect > button'
    )
  )
  for (const button of document.querySelectorAll('.signerControls > button')) {
    if (button.textContent.trim() === 'Remove signer') targets.add(button)
  }
  for (const button of document.querySelectorAll('.contractVerificationResultActions button')) {
    if (button.textContent.trim() === 'Check another contract') targets.add(button)
  }
  for (const button of document.querySelectorAll('.contractVerificationCredentialActions button')) {
    if (['Save', 'Replace', 'Saving…'].includes(button.textContent.trim())) targets.add(button)
  }
  const state = document.querySelector('.sendRequestState')
  const stateButtons = [...(state?.querySelectorAll(':scope > button') || [])]
  if (stateButtons.length === 1) {
    for (const button of stateButtons) {
      if (button.textContent.trim() === 'Close') targets.add(button)
    }
  }
  const buttons = [...document.querySelectorAll('button')]
  const modal = document.querySelector('[aria-modal="true"]')
  return [...targets]
    .filter(
      (button) =>
        button.getClientRects().length &&
        !button.closest('details:not([open])') &&
        (!modal || modal.contains(button))
    )
    .map((button) => ({
      index: buttons.indexOf(button),
      name: button.textContent.trim(),
      disabled: button.disabled
    }))
}

const measure = (index) => {
  const button = document.querySelectorAll('button')[index]
  const css = getComputedStyle(button)
  const box = button.getBoundingClientRect()
  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    border: parseFloat(css.borderTopWidth),
    edge: css.borderTopColor,
    fill: css.backgroundColor,
    color: css.color,
    shadow: css.boxShadow,
    transform: css.transform,
    outline: parseFloat(css.outlineWidth),
    opacity: parseFloat(css.opacity),
    cursor: css.cursor
  }
}

const protectedControls = () => {
  const targets = [
    ...document.querySelectorAll(
      '.addressBookRow:not([role="alertdialog"]) .addressBookEdit, ' +
        '.addressBookRow:not([role="alertdialog"]) .addressBookRemove, .sendMaxAction'
    )
  ]
  const stateButtons = [...document.querySelectorAll('.sendRequestState > button')]
  if (stateButtons.length > 1) {
    targets.push(...stateButtons.filter((button) => button.textContent.trim() === 'Close'))
  }
  return targets.map((button) => {
    const css = getComputedStyle(button)
    return { name: button.textContent.trim(), fill: css.backgroundColor, shadow: css.boxShadow }
  })
}

const painted = (value) => value !== 'transparent' && !(/^rgba\(/.test(value) && /,\s*0\)$/.test(value))

// Select critical command contexts independently of the typography marker.
const labelTypography = () => {
  const targets = new Set(
    document.querySelectorAll(
      '.addressBookRow .addressBookEdit, .addressBookRow .addressBookRemove, ' +
        '.revokeAccessButton, .revokeAccessLabel, .clearPermissionsAction, ' +
        '.sendMaxAction, .sendRecipientCopy, .sendQuoteEdit, .sendSweepSelectAll, ' +
        '.sendSweepRecipient button, .sendSweepCopies button, .sendConfirmedDestination button, ' +
        '.requestClearAll, .earnYearnLink, .contractVerificationExternal'
    )
  )
  for (const button of document.querySelectorAll('.wrenSettingsSection button')) {
    if (/^(Edit|Cancel|Clear|Revoke|Remove|Copy full connection ID)$/.test(button.textContent.trim())) {
      targets.add(button)
    }
  }
  for (const button of document.querySelectorAll('button')) {
    const label = button.textContent.trim()
    if (/^(Cancel|Skip this version|Replace|Refresh status)$/.test(label)) targets.add(button)
  }
  const reference = document.createElement('button')
  reference.className = 'wrenControl wrenControlSecondary'
  reference.hidden = true
  document.body.append(reference)
  try {
    return [...targets]
      .filter(
        (element) => element.getClientRects().length && !element.closest('[hidden], details:not([open])')
      )
      .map((element) => {
        const actual = getComputedStyle(element)
        reference.style.fontSize = actual.fontSize
        const expected = getComputedStyle(reference)
        const keys = ['fontFamily', 'fontWeight', 'letterSpacing', 'textTransform']
        return {
          name: element.getAttribute('aria-label') || element.textContent.trim(),
          actual: keys.map((key) => actual[key]),
          expected: keys.map((key) => expected[key])
        }
      })
  } finally {
    reference.remove()
  }
}

module.exports = async (webContents) => {
  const targets = await webContents.executeJavaScript(`(${commands.toString()})()`)
  const results = []
  const read = (index) => webContents.executeJavaScript(`(${measure.toString()})(${index})`)
  const settle = () => new Promise((resolve) => setTimeout(resolve, 180))
  for (const target of targets) {
    const expression = `document.querySelectorAll('button')[${target.index}]`
    await webContents.executeJavaScript(`${expression}.scrollIntoView({block:'center'})`)
    const rest = await read(target.index)
    assert(rest.height >= 44, `${target.name}: command target below 44px`)
    assert(
      rest.border >= 1 && painted(rest.edge) && painted(rest.fill),
      `${target.name}: no resting button body`
    )
    if (!target.disabled) {
      assert.equal(rest.cursor, 'pointer', `${target.name}: no action cursor`)
      const zoom = webContents.getZoomFactor()
      const point = {
        x: Math.round((rest.x + rest.width / 2) * zoom),
        y: Math.round((rest.y + rest.height / 2) * zoom)
      }
      try {
        webContents.sendInputEvent({ type: 'mouseMove', ...point })
        await settle()
        const hover = await read(target.index)
        assert(
          hover.fill !== rest.fill || hover.edge !== rest.edge || hover.shadow !== rest.shadow,
          `${target.name}: no hover feedback`
        )
        webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
        await settle()
        const pressed = await read(target.index)
        assert(
          pressed.transform !== rest.transform ||
            pressed.shadow !== hover.shadow ||
            pressed.fill !== hover.fill,
          `${target.name}: no press feedback`
        )
      } finally {
        // Release away from the command so the test never activates its callback.
        webContents.sendInputEvent({ type: 'mouseMove', x: 0, y: 0 })
        webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: 0, y: 0 })
      }
      await webContents.executeJavaScript(`${expression}.blur(); document.activeElement?.blur()`)
      webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' })
      webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' })
      await webContents.executeJavaScript(`${expression}.focus({preventScroll:true})`)
      assert((await read(target.index)).outline >= 2, `${target.name}: no keyboard focus ring`)
      try {
        await webContents.executeJavaScript(`${expression}.disabled = true`)
        await settle()
        const disabled = await read(target.index)
        assert(
          disabled.cursor !== 'pointer' && (disabled.color !== rest.color || disabled.opacity < rest.opacity),
          `${target.name}: no disabled feedback`
        )
      } finally {
        await webContents.executeJavaScript(`${expression}.disabled = false; ${expression}.blur()`)
      }
      await settle()
    }
    results.push(
      `${target.name}: rest body, 44px${target.disabled ? ', disabled' : ', hover, press, keyboard focus, disabled'}`
    )
  }
  const flat = await webContents.executeJavaScript(`(${protectedControls.toString()})()`)
  for (const control of flat) {
    assert(
      !painted(control.fill) && control.shadow === 'none',
      `${control.name}: contextual control became tactile`
    )
  }
  const labels = await webContents.executeJavaScript(`(${labelTypography.toString()})()`)
  for (const label of labels) {
    assert.deepEqual(
      label.actual,
      label.expected,
      `${label.name}: command label differs from bordered buttons`
    )
    results.push(`${label.name}: shared command label typography`)
  }
  return { commands: results, protectedFlat: flat.map((control) => control.name) }
}
