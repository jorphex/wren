'use strict'

const auditPage = async ({
  compactExceptions,
  expectedInitialFocus,
  expectedViewport,
  layoutExpectations = [],
  requiredControls = [],
  requiredText = []
}) => {
  const violations = []
  const exceptions = []
  const viewport = { width: window.innerWidth, height: window.innerHeight }
  const describe = (element) => {
    const name =
      element.getAttribute?.('aria-label') ||
      element.getAttribute?.('title') ||
      element.innerText?.replace(/\s+/gu, ' ').trim() ||
      element.id ||
      element.className ||
      element.tagName
    return String(name).slice(0, 120)
  }
  const visible = (element) => {
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      Number(style.opacity) !== 0 &&
      rect.width > 0 &&
      rect.height > 0
    )
  }
  const fullyInViewport = (rect) =>
    rect.left >= -1 &&
    rect.top >= -1 &&
    rect.right <= viewport.width + 1 &&
    rect.bottom <= viewport.height + 1
  const unobscured = (element, rect) => {
    const x = Math.min(viewport.width - 1, Math.max(0, rect.left + rect.width / 2))
    const y = Math.min(viewport.height - 1, Math.max(0, rect.top + rect.height / 2))
    const hit = document.elementFromPoint(x, y)
    return Boolean(hit && (hit === element || element.contains(hit)))
  }
  const accessibleName = (element) =>
    Boolean(
      element.getAttribute('aria-label')?.trim() ||
      element.getAttribute('aria-labelledby')?.trim() ||
      element.getAttribute('title')?.trim() ||
      Array.from(element.labels || []).some((label) => label.textContent?.trim()) ||
      element.innerText?.trim() ||
      (element.tagName === 'INPUT' && element.getAttribute('placeholder')?.trim())
    )

  const normalizedText = (value) =>
    String(value || '')
      .replace(/\s+/gu, ' ')
      .trim()
  const controlName = (control) =>
    normalizedText(
      control.getAttribute('aria-label') ||
        Array.from(control.labels || [])
          .map((label) => label.textContent)
          .join(' ') ||
        control.innerText ||
        control.getAttribute('placeholder')
    )
  const initialFocus = normalizedText(
    document.activeElement?.getAttribute?.('aria-label') || document.activeElement?.innerText
  )
  if (expectedInitialFocus && initialFocus !== expectedInitialFocus) {
    violations.push({
      kind: 'initial-focus',
      detail: `expected ${expectedInitialFocus}, got ${initialFocus || '<none>'}`
    })
  }

  const pageText = normalizedText(document.body?.innerText)
  for (const text of requiredText) {
    if (!pageText.includes(text)) violations.push({ kind: 'required-text', detail: text })
  }

  for (const expectation of layoutExpectations) {
    const candidates = Array.from(document.querySelectorAll(expectation.selector))
    const elements = candidates.filter(visible)
    if (expectation.kind === 'hidden') {
      if (elements.length) {
        violations.push({ kind: 'required-layout', detail: `${expectation.selector} is visible` })
      }
      continue
    }
    if (!elements.length) {
      violations.push({ kind: 'required-layout', detail: `missing ${expectation.selector}` })
      continue
    }

    if (expectation.kind === 'stacked') {
      const rects = elements.map((element) => element.getBoundingClientRect())
      if (rects.some((rect, index) => index > 0 && rect.top < rects[index - 1].bottom - 1)) {
        violations.push({ kind: 'required-layout', detail: `${expectation.selector} is not stacked` })
      }
    } else if (expectation.kind === 'full-width') {
      for (const element of elements) {
        const container = element.closest(expectation.container)
        if (!container) {
          violations.push({
            kind: 'required-layout',
            detail: `${expectation.selector} has no ${expectation.container} container`
          })
          continue
        }
        const elementRect = element.getBoundingClientRect()
        const containerRect = container.getBoundingClientRect()
        const inset = expectation.inset || 0
        if (
          Math.abs(elementRect.left - (containerRect.left + inset)) > 2 ||
          Math.abs(elementRect.right - (containerRect.right - inset)) > 2
        ) {
          violations.push({
            kind: 'required-layout',
            detail: `${expectation.selector} is ${Math.round(elementRect.width)}px within ${Math.round(containerRect.width)}px`
          })
        }
      }
    } else if (expectation.kind === 'size') {
      for (const element of elements) {
        const rect = element.getBoundingClientRect()
        if (Math.abs(rect.width - expectation.width) > 1 || Math.abs(rect.height - expectation.height) > 1) {
          violations.push({
            kind: 'required-layout',
            detail: `${expectation.selector} is ${Math.round(rect.width)}x${Math.round(rect.height)}; expected ${expectation.width}x${expectation.height}`
          })
        }
      }
    } else if (expectation.kind === 'viewport-bottom') {
      for (const element of elements) {
        const rect = element.getBoundingClientRect()
        if (Math.abs(rect.bottom - viewport.height) > 1) {
          violations.push({
            kind: 'required-layout',
            detail: `${expectation.selector} ends at ${Math.round(rect.bottom)}px; viewport ends at ${viewport.height}px`
          })
        }
      }
    } else {
      violations.push({ kind: 'required-layout', detail: `unknown ${expectation.kind}` })
    }
  }

  if (
    Math.abs(viewport.width - expectedViewport.width) > 2 ||
    Math.abs(viewport.height - expectedViewport.height) > 2
  ) {
    violations.push({
      kind: 'viewport',
      detail: `expected ${expectedViewport.width}x${expectedViewport.height}, got ${viewport.width}x${viewport.height}`
    })
  }

  for (const root of [document.documentElement, document.body]) {
    if (root.scrollWidth > root.clientWidth + 1) {
      violations.push({
        kind: 'horizontal-overflow',
        detail: `${root.tagName.toLowerCase()} is ${root.scrollWidth - root.clientWidth}px wider than its viewport`
      })
    }
  }

  const controlSelector =
    'button, a[href], input, select, textarea, summary, [role="button"], [tabindex]:not([tabindex="-1"])'
  const modalRoot = Array.from(document.querySelectorAll('[aria-modal="true"]')).find(visible)
  const controls = Array.from((modalRoot || document).querySelectorAll(controlSelector)).filter(
    (element) => visible(element) && !element.disabled && !element.closest('[aria-hidden="true"], [inert]')
  )

  for (const name of requiredControls) {
    const matchingControl = controls.find((control) => controlName(control).includes(name))
    if (!matchingControl) violations.push({ kind: 'required-control', detail: name })
  }

  for (const control of controls) {
    const label = describe(control)
    const associatedLabel =
      control.tagName === 'INPUT' && ['checkbox', 'radio'].includes(control.type)
        ? Array.from(control.labels || []).find(visible)
        : undefined
    const target = associatedLabel || control
    let rect = target.getBoundingClientRect()
    if (!accessibleName(control)) violations.push({ kind: 'control-name', detail: label })
    if (rect.width <= 0 || rect.height <= 0) {
      violations.push({ kind: 'control-size', detail: `${label} has no rendered area` })
      continue
    }

    if (!fullyInViewport(rect) || !unobscured(target, rect)) {
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      rect = target.getBoundingClientRect()
    }
    if (!fullyInViewport(rect) || !unobscured(target, rect)) {
      violations.push({ kind: 'control-reachability', detail: label })
    }

    control.focus({ preventScroll: true })
    if (document.activeElement !== control && !control.contains(document.activeElement)) {
      violations.push({ kind: 'keyboard-focus', detail: label })
    } else if (!fullyInViewport(control.getBoundingClientRect())) {
      violations.push({ kind: 'focused-control-hidden', detail: label })
    }

    const compact = compactExceptions.find(({ selector }) => control.matches(selector))
    const minimum = compact?.minimum || 44
    if (rect.width + 0.5 < minimum || rect.height + 0.5 < minimum) {
      violations.push({
        kind: 'target-size',
        detail: `${label} is ${Math.round(rect.width)}x${Math.round(rect.height)}; minimum is ${minimum}px`
      })
    } else if (compact && (rect.width < 44 || rect.height < 44)) {
      exceptions.push({ label, selector: compact.selector, reason: compact.reason })
    }
  }

  const textParents = new Set()
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (!node.textContent.trim()) continue
    const parent = node.parentElement
    if (parent && visible(parent) && !['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) {
      textParents.add(parent)
    }
  }
  for (const element of textParents) {
    const size = Number.parseFloat(getComputedStyle(element).fontSize)
    if (Number.isFinite(size) && size < 12) {
      violations.push({ kind: 'text-size', detail: `${describe(element)} uses ${size}px text` })
    }
  }

  controls[0]?.focus({ preventScroll: false })
  const focused = document.activeElement
  if (focused && focused !== document.body && !fullyInViewport(focused.getBoundingClientRect())) {
    violations.push({ kind: 'final-focus-hidden', detail: describe(focused) })
  }

  return {
    controlCount: controls.length,
    exceptions,
    textNodeCount: textParents.size,
    viewport,
    violations
  }
}

module.exports = { auditPage }
