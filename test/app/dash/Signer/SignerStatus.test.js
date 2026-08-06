import { act, render, screen } from '../../../componentSetup'
import link from '../../../../resources/link'
import { SignerStatus } from '../../../../app/dash/Signer/SignerStatus'

jest.mock('../../../../resources/link', () => ({ rpc: jest.fn() }))

const signer = { id: 'hot-1', type: 'ring', status: 'locked' }

it('submits one signer unlock and allows a retry after an error', async () => {
  let fail
  let succeed
  link.rpc
    .mockImplementationOnce((_action, _id, _password, callback) => {
      fail = callback
    })
    .mockImplementationOnce((_action, _id, _password, callback) => {
      succeed = callback
    })
  const { user } = render(<SignerStatus signer={signer} />)

  expect(screen.getByRole('button', { name: 'Unlock' }).disabled).toBe(true)
  await user.type(screen.getByLabelText('Signer password'), 'first-password')
  await user.keyboard('{Enter}{Enter}')

  expect(link.rpc).toHaveBeenCalledTimes(1)
  expect(link.rpc).toHaveBeenCalledWith('unlockSigner', 'hot-1', 'first-password', expect.any(Function))
  act(() => fail(new Error('Incorrect password')))
  expect(screen.getByRole('alert').textContent).toBe('Incorrect password')

  await user.type(screen.getByLabelText('Signer password'), 'second-password')
  await user.click(screen.getByRole('button', { name: 'Unlock' }))
  expect(link.rpc).toHaveBeenCalledTimes(2)
  act(() => succeed(null))
})

it('ignores an unlock callback after unmount', async () => {
  let finish
  link.rpc.mockImplementationOnce((_action, _id, _password, callback) => {
    finish = callback
  })
  const view = render(<SignerStatus signer={signer} />)
  await view.user.type(screen.getByLabelText('Signer password'), 'password')
  await view.user.click(screen.getByRole('button', { name: 'Unlock' }))
  view.unmount()

  act(() => finish(new Error('late error')))
})
