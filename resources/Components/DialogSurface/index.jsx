import React, { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from 'react'

const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'iframe',
  'object',
  'embed',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]'
].join(', ')

const modalStack = []
let hiddenBackground = []
let focusGuardAttached = false

const isVisible = (element) => {
  if (!element?.isConnected || element.closest('[hidden], [aria-hidden="true"], [inert]')) return false

  let current = element
  while (current && current.nodeType === 1) {
    const style = window.getComputedStyle(current)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    current = current.parentElement
  }
  return true
}

const isFocusable = (element) => {
  if (!isVisible(element) || element.matches?.(':disabled')) return false
  return element.tabIndex >= 0
}

const focusableWithin = (dialog) => Array.from(dialog?.querySelectorAll(FOCUSABLE) || []).filter(isFocusable)

const focusInitial = (dialog, initialFocusRef) => {
  if (!dialog) return

  const requested = initialFocusRef?.current
  const marked = Array.from(dialog.querySelectorAll('[data-dialog-initial-focus]')).find(isFocusable)
  const target =
    (dialog.contains(requested) && isFocusable(requested) && requested) ||
    marked ||
    focusableWithin(dialog)[0] ||
    dialog

  target.focus?.()
  if (document.activeElement !== target && target !== dialog) dialog.focus?.()
}

const restoreBackground = () => {
  hiddenBackground.forEach(({ element, ariaHidden, hadInert, inertValue }) => {
    if (ariaHidden === null) element.removeAttribute('aria-hidden')
    else element.setAttribute('aria-hidden', ariaHidden)

    if (hadInert) element.setAttribute('inert', '')
    else element.removeAttribute('inert')
    if ('inert' in element) element.inert = inertValue
  })
  hiddenBackground = []
}

const backgroundFor = (dialog) => {
  const background = new Set()
  let current = dialog

  while (current?.parentElement && current !== document.body) {
    Array.from(current.parentElement.children).forEach((sibling) => {
      if (sibling !== current) background.add(sibling)
    })
    current = current.parentElement
  }
  return Array.from(background)
}

const guardModalFocus = (event) => {
  const top = modalStack[modalStack.length - 1]
  if (!top || top.dialog.contains(event.target)) return
  focusInitial(top.dialog, top.initialFocusRef)
}

const applyModalState = () => {
  restoreBackground()

  const top = modalStack[modalStack.length - 1]
  if (!top) {
    if (focusGuardAttached) document.removeEventListener('focusin', guardModalFocus)
    focusGuardAttached = false
    return
  }

  hiddenBackground = backgroundFor(top.dialog).map((element) => ({
    element,
    ariaHidden: element.getAttribute('aria-hidden'),
    hadInert: element.hasAttribute('inert'),
    inertValue: 'inert' in element ? element.inert : undefined
  }))
  hiddenBackground.forEach(({ element }) => {
    element.setAttribute('aria-hidden', 'true')
    element.setAttribute('inert', '')
    if ('inert' in element) element.inert = true
  })

  if (!focusGuardAttached) document.addEventListener('focusin', guardModalFocus)
  focusGuardAttached = true
}

const registerModal = (dialog, initialFocusRef) => {
  const entry = { dialog, initialFocusRef }
  modalStack.push(entry)
  applyModalState()

  return () => {
    const index = modalStack.indexOf(entry)
    if (index !== -1) modalStack.splice(index, 1)
    applyModalState()
  }
}

const restoreFocus = (returnFocusRef, previousFocus) => {
  const requested = returnFocusRef?.current
  if (requested?.isConnected) {
    requested.focus?.()
  } else if (previousFocus?.isConnected && previousFocus !== document.body) {
    previousFocus.focus?.()
  }

  if (returnFocusRef) {
    queueMicrotask(() => {
      if (document.activeElement?.isConnected && document.activeElement !== document.body) return
      const deferredTarget = returnFocusRef.current
      if (deferredTarget?.isConnected) deferredTarget.focus?.()
    })
  }
}

const DialogSurface = forwardRef(function DialogSurface(
  {
    children,
    as: Surface = 'div',
    className,
    role = 'dialog',
    ariaLabel,
    labelledBy,
    describedBy,
    busy = false,
    modal = false,
    initialFocusRef,
    returnFocusRef,
    onCancel,
    cancelWhenBusy = false,
    onKeyDown: callerOnKeyDown,
    tabIndex = -1,
    ...surfaceProps
  },
  forwardedRef
) {
  const dialogRef = useRef()
  const previousFocusRef = useRef()

  useImperativeHandle(forwardedRef, () => dialogRef.current)

  useLayoutEffect(() => {
    previousFocusRef.current = document.activeElement
    const dialog = dialogRef.current
    const cleanupModal = modal ? registerModal(dialog, initialFocusRef) : null
    focusInitial(dialog, initialFocusRef)

    return () => {
      cleanupModal?.()
      restoreFocus(returnFocusRef, previousFocusRef.current)
    }
  }, [])

  const onKeyDown = (event) => {
    callerOnKeyDown?.(event)
    if (event.defaultPrevented) return

    if (event.key === 'Escape' && onCancel && (!busy || cancelWhenBusy)) {
      event.preventDefault()
      event.stopPropagation()
      onCancel()
      return
    }
    if (!modal || event.key !== 'Tab' || !dialogRef.current) return

    const focusable = focusableWithin(dialogRef.current)
    if (!focusable.length) {
      event.preventDefault()
      dialogRef.current.focus()
      return
    }

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (
      event.shiftKey &&
      (document.activeElement === first || document.activeElement === dialogRef.current)
    ) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <Surface
      {...surfaceProps}
      ref={dialogRef}
      className={className}
      role={role}
      aria-modal={modal ? 'true' : undefined}
      aria-label={ariaLabel ?? surfaceProps['aria-label']}
      aria-labelledby={labelledBy ?? surfaceProps['aria-labelledby']}
      aria-describedby={describedBy ?? surfaceProps['aria-describedby']}
      aria-busy={busy || surfaceProps['aria-busy'] || undefined}
      tabIndex={tabIndex}
      onKeyDown={onKeyDown}
    >
      {children}
    </Surface>
  )
})

export default DialogSurface
