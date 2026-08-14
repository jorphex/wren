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

const renderSignerPreview = (props) =>
  render(<SignerHarness id='device-1' index={0} expanded={false} name='Test signer' {...props} />)

beforeEach(() => {
  link.rpc.mockReset()
  link.send.mockReset()
})

it('derives address capacity from the supported shell heights', () => {
  expect(getAddressLimit(744)).toBe(8)
  expect(getAddressLimit(900)).toBe(11)
  expect(getAddressLimit(2000)).toBe(11)
})

it('maps warning and danger signer status tones to distinct classes', () => {
  const view = renderSignerPreview({ type: 'trezor', status: 'wrong-app', addresses: [] })
  expect(screen.getByRole('status').classList.contains('signerStatusWarning')).toBe(true)

  view.rerender(
    <SignerHarness
      id='device-1'
      expanded={false}
      name='Test signer'
      type='trezor'
      status='device-error'
      addresses={[]}
    />
  )
  expect(screen.getByRole('status').classList.contains('signerStatusDanger')).toBe(true)
})

it('renders the Trezor PIN matrix as named native controls', () => {
  renderSigner({ type: 'trezor', status: 'need pin' })

  expect(screen.getByRole('heading', { name: 'Enter PIN' })).toBeTruthy()
  expect(screen.getByText(/scrambled matrix/i)).toBeTruthy()
  expect(screen.getAllByRole('button', { name: /PIN position/ })).toHaveLength(9)
  expect(screen.getByRole('button', { name: 'Submit PIN' }).disabled).toBe(true)
  expect(screen.getByRole('status', { name: '0 PIN positions entered' })).toBeTruthy()
})

it('uses a transient hardware-authentication dialog without exposing address management', () => {
  render(
    <SignerHarness
      id='device-1'
      promptOnly
      name='Trezor Safe 5'
      type='trezor'
      status='need pin'
      addresses={['0x00000000000000000000000000000000000000aa']}
    />
  )

  expect(screen.getByRole('dialog', { name: 'Trezor Safe 5 authentication' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Enter PIN' })).toBeTruthy()
  expect(screen.queryByText('Available accounts')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Remove signer' })).toBeNull()
})

it('offers a quiet dismissal for passive hardware authentication', async () => {
  const { user } = render(
    <SignerHarness
      id='device-1'
      promptOnly
      promptDismissible
      name='Trezor Safe 5'
      type='trezor'
      status='need pin'
    />
  )

  const dismiss = screen.getByRole('button', { name: 'Not now' })
  expect(dismiss.classList.contains('hardwareSignerPromptDismiss')).toBe(true)
  await user.click(dismiss)

  expect(link.send).toHaveBeenCalledTimes(1)
  expect(link.send).toHaveBeenCalledWith('dash:dismissHardwarePrompt', 'device-1')
})

it('dismisses passive hardware authentication on Escape', async () => {
  const { user } = render(
    <SignerHarness
      id='device-1'
      promptOnly
      promptDismissible
      name='Trezor Safe 5'
      type='trezor'
      status='need pin'
    />
  )

  await user.keyboard('{Escape}')

  expect(link.send).toHaveBeenCalledWith('dash:dismissHardwarePrompt', 'device-1')
})

it('dismisses a busy but passive authentication prompt on Escape', async () => {
  const { user } = render(
    <SignerHarness
      id='device-1'
      promptOnly
      promptDismissible
      name='Trezor Safe 5'
      type='trezor'
      status='passphrase-on-device'
    />
  )

  await user.keyboard('{Escape}')

  expect(link.send).toHaveBeenCalledWith('dash:dismissHardwarePrompt', 'device-1')
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
  const { user } = renderSigner({ type: 'lattice', status: 'pairing-code-required' })
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
  const view = renderSigner({ type: 'ledger', status: 'ready', addresses: [address] })
  const addAccount = screen.getByRole('button', { name: `Add ${checkSummedAddress} as an account` })

  expect(screen.getByText('0x0000…00AA')).toBeTruthy()
  expect(addAccount.title).toBe(checkSummedAddress)

  view.rerender(
    <SignerHarness
      id='device-1'
      index={0}
      expanded={true}
      name='Test signer'
      type='ledger'
      status='ready'
      addresses={[address]}
      addedAccounts={{ [address]: { address } }}
    />
  )

  const removeAccount = screen.getByRole('button', {
    name: `Remove ${checkSummedAddress} from accounts`
  })
  expect(removeAccount.title).toBe(checkSummedAddress)
})

it('arms signer removal, returns focus safely, and confirms once', async () => {
  const view = renderSigner({ type: 'ledger', status: 'ready', addresses: [] })
  const trigger = screen.getByRole('button', { name: 'Remove signer' })

  await view.user.click(trigger)
  const dialog = screen.getByRole('alertdialog', { name: 'Remove signer?' })
  expect(dialog.getAttribute('aria-modal')).toBeNull()
  expect(dialog.getAttribute('aria-describedby')).toBe('signer-removal-description-device-1')
  expect(screen.getByRole('heading', { name: 'Remove signer?' })).toBeTruthy()
  expect(
    screen.getByText('This removes Test signer from Wren. Accounts using it become watch-only.')
  ).toBeTruthy()
  const cancel = screen.getByRole('button', { name: 'Cancel' })
  expect(document.activeElement).toBe(cancel)

  await view.user.keyboard('{Escape}')
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove signer' }))
  await view.user.click(screen.getByRole('button', { name: 'Remove signer' }))
  await view.user.dblClick(screen.getByRole('button', { name: 'Remove signer' }))

  expect(link.send).toHaveBeenCalledTimes(2)
  expect(link.send).toHaveBeenNthCalledWith(1, 'dash:removeSigner', 'device-1')
  expect(link.send).toHaveBeenNthCalledWith(2, 'tray:action', 'backDash')
})

it('keeps the signer overview compact while showing its account count', () => {
  const addresses = Array.from({ length: 8 }, (_, index) => `0x${(index + 1).toString(16).padStart(40, '0')}`)
  const addedAccounts = Object.fromEntries(addresses.map((address) => [address, { id: address }]))
  render(
    <SignerHarness
      id='device-1'
      expanded={false}
      name='Test signer'
      type='ledger'
      status='ready'
      addresses={addresses}
      addedAccounts={addedAccounts}
    />
  )

  expect(screen.getByText('8 active accounts')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Manage accounts' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /^0x/ })).toBeNull()
})

it('keeps all hardware accounts reachable as address capacity responds to shell height', async () => {
  const originalHeight = window.innerHeight
  const addresses = Array.from({ length: 12 }, (_, index) => {
    return `0x${(index + 1).toString(16).padStart(40, '0')}`
  })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900, writable: true })
  const { user, unmount } = renderSigner({ type: 'trezor', status: 'ready', addresses })

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

it('opens active hardware account management from the signer preview', async () => {
  const address = '0x00000000000000000000000000000000000000aa'
  const accountId = address.toLowerCase()
  const { user } = render(
    <SignerHarness
      id='device-1'
      index={0}
      expanded={false}
      name='Test signer'
      type='trezor'
      status='ready'
      addresses={[address]}
      addedAccounts={{ [accountId]: { address, id: accountId } }}
    />
  )

  await user.click(screen.getByRole('button', { name: 'Manage accounts' }))
  expect(link.send).toHaveBeenCalledWith('tray:action', 'navDash', {
    view: 'expandedSigner',
    data: { signer: 'device-1' }
  })
  expect(screen.queryByLabelText(getAddress(address))).toBeNull()
})
