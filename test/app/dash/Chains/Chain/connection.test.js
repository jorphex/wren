import Restore from 'react-restore'

import { ChainHeader, NetworkEditorToggle } from '../../../../../app/dash/Chains/Chain/Components'
import {
  ChainModule,
  connectionHealthLabel,
  connectionTarget,
  endpointLabel,
  presetLabel
} from '../../../../../app/dash/Chains/Chain/Connection'
import link from '../../../../../resources/link'
import { render, screen } from '../../../../componentSetup'

jest.mock('../../../../../resources/link', () => ({ send: jest.fn() }))
jest.mock(
  '../../../../../resources/Components/Icon',
  () =>
    function IconMock({ name }) {
      return <span data-testid={`${name}-icon`} />
    }
)
jest.mock(
  '../../../../../resources/Components/RingIcon',
  () =>
    function RingIconMock({ block, color, img, noRing, svgName, svgSize }) {
      return (
        <span
          data-block={String(Boolean(block))}
          data-color={color}
          data-img={img}
          data-mark={svgName}
          data-no-ring={String(Boolean(noRing))}
          data-size={svgSize}
          data-testid='chain-icon'
        />
      )
    }
)

function renderConnection(primary = {}) {
  const state = {
    main: {
      networks: {
        ethereum: {
          1: {
            connection: {
              endpoints: [
                {
                  id: 'rpc-1',
                  on: true,
                  connected: true,
                  status: 'connected',
                  current: 'publicnode',
                  ...primary
                }
              ]
            }
          }
        }
      },
      networksMeta: {
        ethereum: {
          1: { blockHeight: 21_000_000, gas: { price: { levels: { fast: '0x3b9aca00' } } } }
        }
      }
    }
  }
  const ConnectedChainModule = Restore.connect(ChainModule, Restore.create(state, {}))

  return render(<ConnectedChainModule id={1} type='ethereum' />)
}

test('presents provider names cleanly', () => {
  expect(presetLabel('publicnode')).toBe('PublicNode')
  expect(presetLabel('custom')).toBe('custom')
  expect(endpointLabel(1, { current: 'custom', custom: 'https://rpc.example/path' })).toBe('rpc.example')
  expect(endpointLabel(1, { current: 'custom', custom: 'https://www.node.example' })).toBe('node.example')
  expect(endpointLabel(1, { current: 'publicnode' })).toBe('PublicNode')
})

test('labels the active endpoint with its measured health', () => {
  expect(connectionHealthLabel({ status: 'connected' })).toBe('Connected')
  expect(connectionHealthLabel({ status: 'degraded', connected: true })).toBe('Degraded')
  expect(connectionHealthLabel({ status: 'loading' })).toBe('Checking connection…')
  expect(connectionHealthLabel({ status: 'standby' })).toBe('Standby')
  expect(connectionHealthLabel({ status: 'error' })).toBe('Unavailable')
})

test('resolves preset and custom endpoints for the editor', () => {
  expect(connectionTarget(1, { current: 'publicnode' })).toBe('https://ethereum-rpc.publicnode.com')
  expect(connectionTarget(1, { current: 'custom', custom: 'https://rpc.example' })).toBe(
    'https://rpc.example'
  )
})

test('keeps the network-list connection summary non-interactive', () => {
  renderConnection()

  expect(screen.getByText('PublicNode')).toBeTruthy()
  expect(screen.getByText('Connected')).toBeTruthy()
  expect(screen.getByText('Block')).toBeTruthy()
  expect(screen.getByText('21,000,000')).toBeTruthy()
  expect(screen.getByText('Gas')).toBeTruthy()
  expect(screen.getByLabelText('Current gas price 1 gwei')).toBeTruthy()
  expect(screen.queryByTestId('globe-icon')).toBeNull()
  expect(screen.queryByTestId('server-icon')).toBeNull()
  expect(screen.queryByRole('button', { name: /RPC connection details/ })).toBeNull()
  expect(screen.queryByRole('combobox')).toBeNull()
})

test('shows a custom endpoint host and degraded health in the network summary', () => {
  renderConnection({ current: 'custom', custom: 'https://slow.rpc.example/private', status: 'degraded' })

  expect(screen.getByText('slow.rpc.example')).toBeTruthy()
  expect(screen.getByText('Degraded')).toBeTruthy()
  expect(screen.queryByText('custom')).toBeNull()
})

test('opens network details from the identity region while keeping the toggle separate', async () => {
  const { user } = render(
    <ChainHeader
      type='ethereum'
      id={137}
      primaryColor='accent2'
      name='Polygon'
      on={true}
      showExpand={true}
      showToggle={true}
    />
  )
  const details = screen.getByRole('button', { name: 'Polygon, Chain ID 137' })
  expect(screen.getByText('Chain ID 137')).toBeTruthy()
  const toggle = screen.getByRole('button', { name: 'Disable Polygon' })

  expect(details.classList.contains('networkDetailsTrigger')).toBe(true)
  expect(details.parentElement).toBe(toggle.parentElement.parentElement)
  details.focus()
  await user.keyboard('{Enter}')
  expect(link.send).toHaveBeenCalledWith('tray:action', 'navDash', {
    view: 'chains',
    data: { selectedChain: { id: 137, type: 'ethereum' } }
  })

  link.send.mockClear()
  await user.click(toggle)
  expect(link.send).toHaveBeenCalledWith('tray:action', 'activateNetwork', 'ethereum', 137, false)
})

test('uses the shared switch language in the network editor', async () => {
  const onChange = jest.fn()
  const { user } = render(<NetworkEditorToggle label='Test network' checked={true} onChange={onChange} />)

  const toggle = screen.getByRole('switch', { name: 'Test network' })
  expect(toggle.classList.contains('wrenToggle')).toBe(true)
  expect(toggle.classList.contains('wrenToggleOn')).toBe(true)
  await user.click(toggle)
  expect(onChange).toHaveBeenCalledWith(false)
})

test('keeps canonical identity colors for known chains', () => {
  render(
    <ChainHeader
      type='ethereum'
      id={137}
      icon='https://example.com/untrusted-polygon.png'
      primaryColor='accent2'
      name='Polygon'
      on={true}
      showExpand={true}
      showToggle={true}
    />
  )

  const icon = screen.getByTestId('chain-icon')
  expect(icon.getAttribute('data-color')).toBe('var(--wren-chain-polygon)')
  expect(icon.getAttribute('data-img')).toBeNull()
  expect(icon.getAttribute('data-block')).toBe('true')
  expect(icon.getAttribute('data-no-ring')).toBe('true')
  expect(icon.getAttribute('data-size')).toBe('20')
})

test('uses the shared testnet identity color with the canonical family mark', () => {
  render(
    <ChainHeader
      type='ethereum'
      id={137}
      isTestnet={true}
      name='Polygon Testnet'
      on={false}
      showExpand={true}
      showToggle={true}
    />
  )

  const icon = screen.getByTestId('chain-icon')
  expect(icon.getAttribute('data-color')).toBe('var(--wren-chain-testnet)')
  expect(icon.getAttribute('data-mark')).toBe('polygon')
})

test('preserves the selected identity color for a custom chain', () => {
  render(
    <ChainHeader
      type='ethereum'
      id={1337}
      icon='https://example.com/leetnet.png'
      primaryColor='accent6'
      name='Leetnet'
      on={true}
      showExpand={true}
      showToggle={true}
    />
  )

  const icon = screen.getByTestId('chain-icon')
  expect(icon.getAttribute('data-color')).toBe('var(--accent6)')
  expect(icon.getAttribute('data-mark')).toBe('chain')
  expect(icon.getAttribute('data-img')).toBe('https://example.com/leetnet.png')
  expect(icon.getAttribute('data-block')).toBe('false')
  expect(icon.getAttribute('data-no-ring')).toBe('false')
  expect(icon.getAttribute('data-size')).toBeNull()
})
