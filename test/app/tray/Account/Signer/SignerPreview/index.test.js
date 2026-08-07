import { act, render, screen } from '../../../../../componentSetup'
import { Signer } from '../../../../../../app/tray/Account/Signer/SignerPreview'
import link from '../../../../../../resources/link'

jest.mock('../../../../../../resources/link', () => ({ rpc: jest.fn(), send: jest.fn() }))

const account = '0x0000000000000000000000000000000000000001'
const activeSigner = { id: 'trezor-device', status: 'ok', type: 'trezor' }

const state = {
  main: {
    accounts: {
      [account]: { id: account, lastSignerType: 'trezor', signer: activeSigner.id }
    },
    signers: { [activeSigner.id]: activeSigner }
  }
}

const store = (...path) =>
  path.flatMap((segment) => String(segment).split('.')).reduce((value, segment) => value?.[segment], state)

class SignerHarness extends Signer {
  constructor(props) {
    super(props)
    this.store = store
  }
}

const renderSigner = () => render(<SignerHarness account={account} expanded moduleId='signer' />)

test('opens signer details once with the exact dashboard breadcrumb', async () => {
  const { user } = renderSigner()

  await user.dblClick(screen.getByRole('button', { name: 'Open signer details' }))

  expect(link.send.mock.calls).toEqual([
    ['tray:action', 'navDash', { view: 'expandedSigner', data: { signer: activeSigner.id } }]
  ])
})

test('keeps hardware address verification single-flight until its callback settles', async () => {
  const { user } = renderSigner()
  const verify = screen.getByRole('button', { name: 'Verify account address on signer' })

  verify.focus()
  await user.keyboard('{Enter}')
  await user.click(verify)

  expect(link.rpc).toHaveBeenCalledTimes(1)
  expect(verify.disabled).toBe(true)

  const callback = link.rpc.mock.calls[0][1]
  act(() => callback(null))

  expect(screen.getByText('Address matched!')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Verify account address on signer' }).disabled).toBe(false)
})

test('ignores a hardware verification callback after unmount', async () => {
  const { unmount, user } = renderSigner()

  await user.click(screen.getByRole('button', { name: 'Verify account address on signer' }))
  const callback = link.rpc.mock.calls[0][1]
  unmount()

  expect(() => act(() => callback(new Error('disconnected')))).not.toThrow()
})
