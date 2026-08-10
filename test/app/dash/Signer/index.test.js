import { act, render, screen } from '../../../componentSetup'
import link from '../../../../resources/link'
import { getAddressLimit, Signer } from '../../../../app/dash/Signer'
import { getAddress } from '../../../../resources/utils'

jest.mock('../../../../resources/link', () => ({
  send: jest.fn(),
  rpc: jest.fn()
}))

class SignerHarness extends Signer {
  renderSignerStatus() {
    return null
  }

  store(...path) {
    if (path[0] === 'main.signers') {
      return {
        id: this.props.id,
        type: this.props.type,
        status: this.props.status,
        addresses: this.props.addresses || []
      }
    }
    if (path[0] === 'main.accounts') return this.props.addedAccounts?.[path[1]]
    if (path[0] === 'selected.current') return this.props.currentAccount || ''
  }
}

const renderSigner = (props) =>
  render(<SignerHarness id='device-1' expanded={true} name='Test signer' {...props} />)

beforeEach(() => {
  link.rpc.mockReset()
  link.send.mockReset()
})

it('derives address capacity from the supported shell heights', () => {
  expect(getAddressLimit(744)).toBe(8)
  expect(getAddressLimit(900)).toBe(11)
  expect(getAddressLimit(2000)).toBe(11)
})

it('renders the Trezor PIN matrix as named native controls', () => {
  renderSigner({ type: 'trezor', status: 'need pin' })

  expect(screen.getAllByRole('button', { name: /PIN position/ })).toHaveLength(9)
  expect(screen.getByRole('button', { name: 'Submit PIN' }).disabled).toBe(true)
  expect(screen.getByRole('status', { name: '0 PIN positions entered' })).toBeTruthy()
})

it('submits one Trezor PIN with the original RPC payload', async () => {
  link.rpc.mockImplementationOnce((_action, _id, _pin, callback) => callback())
  const { user } = renderSigner({ type: 'trezor', status: 'need pin' })

  await user.click(screen.getByRole('button', { name: 'PIN position 1' }))
  await user.click(screen.getByRole('button', { name: 'PIN position 2' }))
  await user.dblClick(screen.getByRole('button', { name: 'Submit PIN' }))

  expect(link.rpc).toHaveBeenCalledTimes(1)
  expect(link.rpc).toHaveBeenCalledWith('trezorPin', 'device-1', '12', expect.any(Function))
})

it('allows one empty Trezor passphrase submission from the keyboard', async () => {
  link.rpc.mockImplementation((_action, _id, _phrase, callback) => callback())
  const view = renderSigner({ type: 'trezor', status: 'enter passphrase' })
  const input = screen.getByLabelText('Trezor passphrase')

  await view.user.click(input)
  await view.user.keyboard('{Enter}{Enter}')

  expect(link.rpc).toHaveBeenCalledTimes(1)
  expect(link.rpc).toHaveBeenCalledWith('trezorPhrase', 'device-1', '', expect.any(Function))

  view.rerender(
    <SignerHarness id='device-1' expanded={true} name='Test signer' type='trezor' status='connecting' />
  )
  view.rerender(
    <SignerHarness id='device-1' expanded={true} name='Test signer' type='trezor' status='enter passphrase' />
  )
  await view.user.click(screen.getByLabelText('Trezor passphrase'))
  await view.user.keyboard('{Enter}')
  expect(link.rpc).toHaveBeenCalledTimes(2)
})

it('guards passphrase-on-device activation', async () => {
  link.rpc.mockImplementationOnce((_action, _id, callback) => callback())
  const { user } = renderSigner({
    type: 'trezor',
    status: 'enter passphrase',
    capabilities: ['Capability_PassphraseEntry']
  })

  await user.dblClick(screen.getByRole('button', { name: 'Enter passphrase on device' }))

  expect(link.rpc).toHaveBeenCalledTimes(1)
  expect(link.rpc).toHaveBeenCalledWith('trezorEnterPhrase', 'device-1', expect.any(Function))
})

it('submits one normalized Trezor pairing code', async () => {
  link.rpc.mockImplementationOnce((_action, _id, _payload, callback) => callback())
  const { user } = renderSigner({
    type: 'trezor',
    status: 'need pairing code',
    pairing: { selectedMethod: 'CodeEntry' }
  })

  expect(screen.getByRole('button', { name: 'Submit pairing code' }).disabled).toBe(true)
  await user.type(screen.getByRole('textbox', { name: 'Trezor pairing code' }), 'abc123')
  await user.keyboard('{Enter}{Enter}')

  expect(link.rpc).toHaveBeenCalledTimes(1)
  expect(link.rpc).toHaveBeenCalledWith('trezorPairing', 'device-1', { tag: 'ABC123' }, expect.any(Function))
})

it('keeps a GridPlus pairing code available after an error and retries once', async () => {
  let fail
  let succeed
  link.rpc
    .mockImplementationOnce((_action, _id, _code, callback) => {
      fail = callback
    })
    .mockImplementationOnce((_action, _id, _code, callback) => {
      succeed = callback
    })
  const { user } = renderSigner({ type: 'lattice', status: 'pair' })
  const input = screen.getByRole('textbox', { name: 'GridPlus pairing code' })

  expect(screen.getByRole('button', { name: 'Pair' }).disabled).toBe(true)
  await user.type(input, 'abc123')
  await user.dblClick(screen.getByRole('button', { name: 'Pair' }))
  expect(link.rpc).toHaveBeenCalledTimes(1)
  expect(link.rpc).toHaveBeenCalledWith('latticePair', 'device-1', 'ABC123', expect.any(Function))
  act(() => fail('Pairing failed'))

  expect(screen.getByRole('alert').textContent).toBe('Pairing failed')
  expect(input.value).toBe('ABC123')
  await user.click(screen.getByRole('button', { name: 'Pair' }))
  expect(link.rpc).toHaveBeenCalledTimes(2)
  act(() => succeed(null))
  expect(input.value).toBe('')
})

it('names available signer account actions with their current add or remove behavior', () => {
  const address = '0x00000000000000000000000000000000000000aa'
  const checkSummedAddress = getAddress(address)
  const view = renderSigner({ type: 'ledger', status: 'ok', addresses: [address] })

  expect(screen.getByRole('button', { name: `Add ${checkSummedAddress} as an account` })).toBeTruthy()

  view.rerender(
    <SignerHarness
      id='device-1'
      index={0}
      expanded={true}
      name='Test signer'
      type='ledger'
      status='ok'
      addresses={[address]}
      addedAccounts={{ [address]: { address } }}
    />
  )

  expect(screen.getByRole('button', { name: `Remove ${checkSummedAddress} from accounts` })).toBeTruthy()
})

it('keeps all hardware accounts reachable as address capacity responds to shell height', async () => {
  const originalHeight = window.innerHeight
  const addresses = Array.from({ length: 12 }, (_, index) => {
    return `0x${(index + 1).toString(16).padStart(40, '0')}`
  })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900, writable: true })
  const { user, unmount } = renderSigner({ type: 'trezor', status: 'ok', addresses })

  expect(screen.queryByText('Ready to sign')).toBeNull()
  expect(screen.getAllByRole('button', { name: /^Add 0x/ })).toHaveLength(11)
  expect(screen.getByText('1 / 2')).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'Next address page' }))
  expect(screen.getAllByRole('button', { name: /^Add 0x/ })).toHaveLength(1)

  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 744, writable: true })
  act(() => window.dispatchEvent(new Event('resize')))
  expect(screen.getAllByRole('button', { name: /^Add 0x/ })).toHaveLength(4)
  expect(screen.getByText('2 / 2')).toBeTruthy()

  unmount()
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight, writable: true })
})

it('selects an active hardware account from the signer preview', async () => {
  const address = '0x00000000000000000000000000000000000000aa'
  const accountId = address.toLowerCase()
  const { user } = render(
    <SignerHarness
      id='device-1'
      index={0}
      expanded={false}
      name='Test signer'
      type='trezor'
      status='ok'
      addresses={[address]}
      addedAccounts={{ [accountId]: { address, id: accountId } }}
    />
  )

  await user.click(screen.getByRole('button', { name: getAddress(address) }))
  expect(link.rpc).toHaveBeenCalledWith('setSigner', accountId, expect.any(Function))
})
