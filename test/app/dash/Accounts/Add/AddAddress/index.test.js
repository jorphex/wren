import Restore from 'react-restore'

import store from '../../../../../../main/store'
import link from '../../../../../../resources/link'
import { act, screen, render } from '../../../../../componentSetup'
import AddAdressComponent from '../../../../../../app/dash/Accounts/Add/AddAddress'

jest.mock('../../../../../../main/store/persist')
jest.mock('../../../../../../resources/link', () => ({ rpc: jest.fn() }))

const AddAddress = Restore.connect(AddAdressComponent, store)
const address = '0x690B9A9E9aa1C9dB991C7721a92d351Db4FaC990'
const ensName = 'vitalik.eth'

it('allows a user to enter an address or ENS name', async () => {
  render(<AddAddress />)

  expect(screen.getByText('Enter an address or ENS name')).toBeTruthy()
  expect(screen.getByRole('textbox')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Create' }).disabled).toBe(true)
})

it('adds an account by address', async () => {
  const { enterText, clickCreate } = setupComponent(<AddAddress />)

  await enterText(address)
  await clickCreate()

  expect(link.rpc).toHaveBeenCalledWith('createFromAddress', address, 'Watch Account', expect.any(Function))
})

it('shows the resolving screen when resolving an ENS name', async () => {
  const { enterText, clickCreate } = setupComponent(<AddAddress />)

  await enterText(ensName)
  await clickCreate()

  expect(screen.getByText('Resolving ENS name')).toBeTruthy()
  expect(link.rpc).toHaveBeenCalledWith('resolveEnsName', ensName, expect.any(Function))
})

it('shows an error screen when ENS name resolution fails', async () => {
  link.rpc.mockImplementationOnce((action, name, cb) => {
    expect(action).toBe('resolveEnsName')
    expect(name).toBe('vitalik.eth')
    cb(new Error('testing!'))
  })

  const { enterText, clickCreate } = setupComponent(<AddAddress />)

  await enterText(ensName)
  await clickCreate()

  expect(await screen.findByText(`Unable to resolve Ethereum address for ${ensName}`)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
})

it('shows a success screen after adding an account by address', async () => {
  link.rpc.mockImplementationOnce((_action, _address, _name, callback) => callback(null))
  const { enterText, clickCreate } = setupComponent(<AddAddress />)

  await enterText(address)
  await clickCreate()

  expect(await screen.findByText('Account added successfully')).toBeTruthy()
  expect(await screen.findByRole('button', { name: 'Back' })).toBeTruthy()
})

it('shows a success screen after adding an account by ENS name', async () => {
  let finishResolution
  let finishCreation
  link.rpc.mockImplementationOnce((action, name, cb) => {
    expect(action).toBe('resolveEnsName')
    expect(name).toBe('vitalik.eth')
    finishResolution = cb
  })
  link.rpc.mockImplementationOnce((_action, _address, _name, cb) => {
    finishCreation = cb
  })

  const { enterText, clickCreate } = setupComponent(<AddAddress />)

  await enterText(ensName)
  await clickCreate()
  await act(async () => {
    finishResolution(null, '0xd8da6bf26964af9d7eed9e03e53415d37aa96045')
  })
  act(() => finishCreation(null))

  expect(screen.getByText('Account added successfully')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy()
})

it('does not report success before watch-account creation completes', async () => {
  const { enterText, clickCreate } = setupComponent(<AddAddress />)

  await enterText(address)
  await clickCreate()

  expect(screen.getByRole('status').textContent).toBe('Adding watch account...')
  expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
})

it('rejects malformed input before calling account creation', async () => {
  const { enterText, clickCreate } = setupComponent(<AddAddress />)

  await enterText('name.eth.invalid!')
  await clickCreate()

  expect(screen.getByRole('alert').textContent).toBe('Enter a valid address or ENS name')
  expect(link.rpc).not.toHaveBeenCalled()
})

it('rejects malformed hexadecimal addresses instead of resolving them as ENS names', async () => {
  const { enterText, clickCreate } = setupComponent(<AddAddress />)

  await enterText('0x1234')
  await clickCreate()

  expect(screen.getByRole('alert').textContent).toBe('Enter a valid address or ENS name')
  expect(link.rpc).not.toHaveBeenCalled()
})

it('resolves valid ENS names outside the eth namespace', async () => {
  const { enterText, clickCreate } = setupComponent(<AddAddress />)

  await enterText('alice.xyz')
  await clickCreate()

  expect(link.rpc).toHaveBeenCalledWith('resolveEnsName', 'alice.xyz', expect.any(Function))
})

it('submits a valid watch address from the keyboard only once', async () => {
  const { user, enterText } = setupComponent(<AddAddress />)

  await enterText(address)
  await user.keyboard('{Enter}{Enter}')

  expect(link.rpc.mock.calls.filter(([action]) => action === 'createFromAddress')).toHaveLength(1)
})

it('restarts when a users cancels an ENS lookup', async () => {
  const { user, enterText, clickCreate } = setupComponent(<AddAddress />)

  await enterText(ensName)
  await clickCreate()
  await user.click(screen.getByRole('button', { name: 'Cancel' }))

  expect(screen.getByText('Enter an address or ENS name')).toBeTruthy()
  expect(screen.getByRole('textbox')).toBeTruthy()
})

it('preserves a new failure when a watch-account retry fails immediately', async () => {
  link.rpc
    .mockImplementationOnce((_action, _name, callback) => callback(new Error('first failure')))
    .mockImplementationOnce((_action, _name, callback) => callback(new Error('second failure')))
  const { user, enterText, clickCreate } = setupComponent(<AddAddress />)

  await enterText(ensName)
  await clickCreate()
  await user.click(await screen.findByRole('button', { name: 'Try again' }))
  await enterText('alice.xyz')
  await clickCreate()
  await screen.findByRole('alert')
  act(() => jest.advanceTimersByTime(500))

  expect(screen.getByRole('alert').textContent).toBe('Unable to resolve Ethereum address for alice.xyz')
})

function setupComponent() {
  const { user } = render(<AddAddress />)

  return {
    user,
    enterText: async (text) => user.type(screen.getByLabelText('Enter an address or ENS name'), text),
    clickCreate: async () => user.click(screen.getByRole('button', { name: 'Create' }))
  }
}
