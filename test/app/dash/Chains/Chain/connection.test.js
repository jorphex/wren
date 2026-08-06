import { ChainModule, presetLabel } from '../../../../../app/dash/Chains/Chain/Connection'
import link from '../../../../../resources/link'
import { act, fireEvent, render, screen } from '../../../../componentSetup'

jest.mock('../../../../../resources/link', () => ({ send: jest.fn() }))

function renderConnection(current = 'publicnode', secondaryOn = false) {
  const state = {
    main: {
      networks: {
        ethereum: {
          1: {
            id: 1,
            on: true,
            connection: {
              primary: {
                on: true,
                status: 'connected',
                network: '1',
                current,
                custom: 'https://rpc.example'
              },
              secondary: { on: secondaryOn, status: 'connected', current: 'custom', custom: '' }
            }
          }
        }
      },
      networksMeta: { ethereum: { 1: { blockHeight: 1 } } }
    }
  }
  const store = (...path) =>
    path.flatMap((segment) => String(segment).split('.')).reduce((value, segment) => value?.[segment], state)
  class TestChainModule extends ChainModule {
    constructor(props) {
      super(props, { store })
      this.store = store
    }
  }
  return render(<TestChainModule expanded id={1} type='ethereum' />)
}

it('presents the PublicNode preset with its provider name', () => {
  expect(presetLabel('publicnode')).toBe('PublicNode')
  expect(presetLabel('custom')).toBe('custom')
})

it('routes primary RPC controls through their existing actions', () => {
  renderConnection()

  fireEvent.click(screen.getByRole('switch', { name: 'Enable primary RPC' }))
  expect(link.send).toHaveBeenCalledWith('tray:action', 'toggleConnection', 'ethereum', 1, 'primary')

  fireEvent.change(screen.getByRole('combobox', { name: 'Primary RPC preset' }), {
    target: { value: 'ethereum:1:custom' }
  })
  expect(link.send).toHaveBeenCalledWith('tray:action', 'selectPrimary', 'ethereum', '1', 'custom')
  expect(screen.getByRole('textbox', { name: 'Custom primary RPC endpoint' }).disabled).toBe(true)
})

it('routes secondary RPC controls through their existing actions', () => {
  renderConnection('publicnode', true)

  fireEvent.click(screen.getByRole('switch', { name: 'Enable secondary RPC' }))
  expect(link.send).toHaveBeenCalledWith('tray:action', 'toggleConnection', 'ethereum', 1, 'secondary')

  fireEvent.change(screen.getByRole('combobox', { name: 'Secondary RPC preset' }), {
    target: { value: 'ethereum:1:publicnode' }
  })
  expect(link.send).toHaveBeenCalledWith('tray:action', 'selectSecondary', 'ethereum', '1', 'publicnode')
})

it('enables and debounces the custom endpoint only for the custom preset', () => {
  renderConnection('custom')
  const input = screen.getByRole('textbox', { name: 'Custom primary RPC endpoint' })

  expect(input.disabled).toBe(false)
  fireEvent.change(input, { target: { value: ' https://new-rpc.example ' } })

  act(() => jest.advanceTimersByTime(999))
  expect(link.send).not.toHaveBeenCalledWith('tray:action', 'setPrimaryCustom', expect.anything())
  act(() => jest.advanceTimersByTime(1))
  expect(link.send).toHaveBeenCalledWith(
    'tray:action',
    'setPrimaryCustom',
    'ethereum',
    1,
    'https://new-rpc.example'
  )
})
