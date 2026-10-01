import RecoveryBoundary from '../../../app/tray/RecoveryBoundary'
import { render, screen } from '../../componentSetup'

it('contains a rendering failure and recovers the view without replaying an action', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => {})
  const approve = jest.fn()
  let failed = true
  function Review() {
    if (failed) throw new Error('Injected renderer fault with private payload')
    return <button onClick={approve}>Sign transaction</button>
  }
  try {
    const view = render(
      <RecoveryBoundary>
        <Review />
      </RecoveryBoundary>
    )
    expect(screen.getByRole('alert').textContent).toContain('Wallet view unavailable')
    failed = false
    await view.user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByRole('button', { name: 'Sign transaction' })).toBeTruthy()
    expect(approve).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith('Wallet view failed to render')
    view.unmount()
  } finally {
    log.mockRestore()
  }
})
