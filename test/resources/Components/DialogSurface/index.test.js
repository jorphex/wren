import { useRef, useState } from 'react'
import DialogSurface from '../../../../resources/Components/DialogSurface'
import { fireEvent, render, screen } from '../../../componentSetup'

const InlineHarness = ({ busy = false, invalidInitial = false, onSurfaceKeyDown }) => {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef()
  const outsideRef = useRef()
  const cancelRef = useRef()

  return (
    <div>
      <button type='button' ref={triggerRef} onClick={() => setOpen(true)}>
        Trigger
      </button>
      <button type='button' ref={outsideRef}>
        Outside
      </button>
      {open ? (
        <DialogSurface
          data-testid='inline-dialog'
          role='alertdialog'
          labelledBy='inline-dialog-title'
          describedBy='inline-dialog-body'
          busy={busy}
          initialFocusRef={invalidInitial ? outsideRef : cancelRef}
          returnFocusRef={triggerRef}
          onCancel={() => setOpen(false)}
          onKeyDown={onSurfaceKeyDown}
        >
          <h2 id='inline-dialog-title'>Remove item?</h2>
          <p id='inline-dialog-body'>This cannot be undone.</p>
          {invalidInitial ? (
            <button type='button' data-dialog-initial-focus disabled>
              Disabled choice
            </button>
          ) : null}
          <button type='button' ref={cancelRef}>
            Cancel
          </button>
          <button type='button'>Remove</button>
        </DialogSurface>
      ) : null}
    </div>
  )
}

const Modal = ({ name, returnFocusRef }) => {
  const cancelRef = useRef()

  return (
    <DialogSurface
      data-testid={`${name}-dialog`}
      role='alertdialog'
      ariaLabel={`${name} dialog`}
      modal
      initialFocusRef={cancelRef}
      returnFocusRef={returnFocusRef}
    >
      <button type='button' ref={cancelRef}>
        {`${name} cancel`}
      </button>
      <button type='button'>{`${name} confirm`}</button>
    </DialogSurface>
  )
}

it('defaults to an inline dialog, composes events, and restores focus when unmounted', async () => {
  const onKeyDown = jest.fn()
  const { user } = render(<InlineHarness onSurfaceKeyDown={onKeyDown} />)
  const trigger = screen.getByRole('button', { name: 'Trigger' })

  await user.click(trigger)
  const dialog = screen.getByRole('alertdialog', { name: 'Remove item?' })
  expect(dialog.getAttribute('aria-modal')).toBeNull()
  expect(dialog.getAttribute('aria-describedby')).toBe('inline-dialog-body')
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))

  await user.keyboard('{Escape}')
  expect(onKeyDown).toHaveBeenCalled()
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(document.activeElement).toBe(trigger)
})

it('rejects an initial focus ref outside the surface and skips a disabled marked action', async () => {
  const { user } = render(<InlineHarness invalidInitial />)

  await user.click(screen.getByRole('button', { name: 'Trigger' }))

  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
})

it('keeps a busy inline dialog open when Escape is pressed', async () => {
  const { user } = render(<InlineHarness busy />)

  await user.click(screen.getByRole('button', { name: 'Trigger' }))
  await user.keyboard('{Escape}')

  expect(screen.getByRole('alertdialog').getAttribute('aria-busy')).toBe('true')
})

it('contains focus in a true modal and restores the background when removed', async () => {
  const Harness = () => {
    const [open, setOpen] = useState(false)
    const triggerRef = useRef()
    return (
      <div>
        <div data-testid='background' aria-hidden='false'>
          <button type='button' ref={triggerRef} onClick={() => setOpen(true)}>
            Open modal
          </button>
          <button type='button'>Outside focus</button>
        </div>
        {open ? <Modal name='only' returnFocusRef={triggerRef} /> : null}
        {open ? (
          <button type='button' onClick={() => setOpen(false)}>
            Close from test
          </button>
        ) : null}
      </div>
    )
  }
  const { user } = render(<Harness />)
  const trigger = screen.getByRole('button', { name: 'Open modal' })

  await user.click(trigger)
  const dialog = screen.getByTestId('only-dialog')
  const background = screen.getByTestId('background')
  const cancel = screen.getByRole('button', { name: 'only cancel' })
  expect(dialog.getAttribute('aria-modal')).toBe('true')
  expect(background.getAttribute('aria-hidden')).toBe('true')
  expect(background.hasAttribute('inert')).toBe(true)

  screen.getByRole('button', { name: 'Outside focus', hidden: true }).focus()
  expect(document.activeElement).toBe(cancel)

  await user.tab({ shift: true })
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'only confirm' }))
  await user.tab()
  expect(document.activeElement).toBe(cancel)

  fireEvent.click(screen.getByText('Close from test'))
  expect(background.getAttribute('aria-hidden')).toBe('false')
  expect(background.hasAttribute('inert')).toBe(false)
  expect(document.activeElement).toBe(trigger)
})

it('keeps only the top of two true modals active and safely reveals the previous modal', () => {
  const Harness = () => {
    const [secondOpen, setSecondOpen] = useState(true)
    const firstReturnRef = useRef()
    return (
      <div>
        <Modal name='first' />
        {secondOpen ? <Modal name='second' returnFocusRef={firstReturnRef} /> : null}
        <button type='button' ref={firstReturnRef} onClick={() => setSecondOpen(false)}>
          Close second
        </button>
      </div>
    )
  }
  render(<Harness />)

  const first = screen.getByTestId('first-dialog')
  const second = screen.getByTestId('second-dialog')
  expect(first.getAttribute('aria-hidden')).toBe('true')
  expect(first.hasAttribute('inert')).toBe(true)
  expect(second.getAttribute('aria-hidden')).toBeNull()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'second cancel' }))

  fireEvent.click(screen.getByText('Close second'))
  expect(screen.queryByTestId('second-dialog')).toBeNull()
  expect(first.getAttribute('aria-hidden')).toBeNull()
  expect(first.hasAttribute('inert')).toBe(false)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'first cancel' }))
})
