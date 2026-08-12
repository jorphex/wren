import DialogSurface from '../../../../resources/Components/DialogSurface'
import { render, screen } from '../../../componentSetup'

const Harness = ({ busy = false, onCancel = jest.fn() }) => (
  <div>
    <button type='button'>Trigger</button>
    <DialogSurface
      role='alertdialog'
      labelledBy='dialog-title'
      describedBy='dialog-body'
      busy={busy}
      onCancel={onCancel}
    >
      <h2 id='dialog-title'>Remove item?</h2>
      <p id='dialog-body'>This cannot be undone.</p>
      <button type='button' data-dialog-initial-focus>
        Cancel
      </button>
      <button type='button'>Remove</button>
    </DialogSurface>
  </div>
)

it('labels a modal, focuses its safe action, traps Tab, and cancels with Escape', async () => {
  const onCancel = jest.fn()
  const { user } = render(<Harness onCancel={onCancel} />)
  const dialog = screen.getByRole('alertdialog', { name: 'Remove item?' })
  const cancel = screen.getByRole('button', { name: 'Cancel' })
  const remove = screen.getByRole('button', { name: 'Remove' })

  expect(dialog.getAttribute('aria-modal')).toBe('true')
  expect(dialog.getAttribute('aria-describedby')).toBe('dialog-body')
  expect(document.activeElement).toBe(cancel)

  await user.tab({ shift: true })
  expect(document.activeElement).toBe(remove)
  await user.tab()
  expect(document.activeElement).toBe(cancel)
  await user.keyboard('{Escape}')
  expect(onCancel).toHaveBeenCalledTimes(1)
})

it('keeps a busy dialog open when Escape is pressed', async () => {
  const onCancel = jest.fn()
  const { user } = render(<Harness busy onCancel={onCancel} />)

  await user.keyboard('{Escape}')

  expect(onCancel).not.toHaveBeenCalled()
  expect(screen.getByRole('alertdialog').getAttribute('aria-busy')).toBe('true')
})
