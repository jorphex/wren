import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

const FOCUSABLE =
  'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'

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
    modal = true,
    initialFocusRef,
    returnFocusRef,
    onCancel
  },
  forwardedRef
) {
  const dialogRef = useRef()
  const previousFocusRef = useRef()

  useImperativeHandle(forwardedRef, () => dialogRef.current)

  useEffect(() => {
    previousFocusRef.current = document.activeElement
    const dialog = dialogRef.current
    const initial =
      initialFocusRef?.current ||
      dialog?.querySelector('[data-dialog-initial-focus]') ||
      dialog?.querySelector(FOCUSABLE) ||
      dialog
    initial?.focus?.()

    return () => {
      const target = returnFocusRef?.current || previousFocusRef.current
      target?.focus?.()
    }
  }, [])

  const onKeyDown = (event) => {
    if (event.key === 'Escape' && onCancel && !busy) {
      event.preventDefault()
      event.stopPropagation()
      onCancel()
      return
    }
    if (!modal || event.key !== 'Tab' || !dialogRef.current) return

    const focusable = Array.from(dialogRef.current.querySelectorAll(FOCUSABLE))
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
      ref={dialogRef}
      className={className}
      role={role}
      aria-modal={modal ? 'true' : undefined}
      aria-label={ariaLabel}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-busy={busy || undefined}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      {children}
    </Surface>
  )
})

export default DialogSurface
