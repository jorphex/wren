import fs from 'fs'

import { Activity, activityOriginLabel, filterActivity } from '../../../../../app/tray/Account/Activity'
import {
  WREN_DEPLOY_DISPLAY_NAME,
  WREN_DEPLOY_ORIGIN,
  originIdForInvoker
} from '../../../../../resources/domain/origin'
import link from '../../../../../resources/link'
import { fireEvent, render, screen } from '../../../../componentSetup'

jest.mock('../../../../../resources/link', () => ({ send: jest.fn() }))

const account = '0x1111111111111111111111111111111111111111'
const transactionHash = `0x${'a'.repeat(64)}`

const entry = (overrides = {}) => ({
  id: crypto.randomUUID(),
  account,
  origin: 'origin-1',
  type: 'transaction',
  outcome: 'confirmed',
  createdAt: 100,
  completedAt: 200,
  chainId: 1,
  transactionHash,
  ...overrides
})

const entries = [
  entry(),
  entry({ type: 'signTypedData', outcome: 'completed', transactionHash: undefined }),
  entry({ type: 'access', outcome: 'completed', transactionHash: undefined }),
  entry({ type: 'walletCalls', outcome: 'failed', transactionHash: undefined }),
  entry({ type: 'addToken', outcome: 'declined', transactionHash: undefined })
]

class ActivityHarness extends Activity {
  store(...path) {
    const key = path.join('.')
    if (key === 'main.activity') return this.props.entries || entries
    if (key === 'main.origins.origin-1.name') return 'garden.example'
    if (key === 'main.networks.ethereum.1.name') return 'Ethereum'
  }
}

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    disconnect() {}
  }
})

afterAll(() => {
  delete global.ResizeObserver
})

beforeEach(() => link.send.mockReset())

it('keeps non-interactive activity rows visually inert', () => {
  const styles = fs.readFileSync('app/tray/Account/Activity/style/index.styl', 'utf8')
  const rowRule = styles.match(/\.activityRow\n([\s\S]*?)\n\.activityMark/)[1]

  expect(rowRule).not.toContain('&:hover')
  expect(styles).toContain("&:not([aria-pressed='true']):hover:not(:disabled)")
})

it('uses the quiet selected treatment shared with Earn filters', () => {
  const styles = fs.readFileSync('app/tray/Account/Activity/style/index.styl', 'utf8')
  expect(styles).toContain(
    "&.wrenControl[aria-pressed='true']\n    color var(--wren-text-primary)\n    background var(--wren-surface-active)\n    border-color var(--wren-border-default)\n    box-shadow var(--wren-shadow-sm), var(--wren-shadow-inset)"
  )
  expect(styles).not.toContain('background var(--wren-bg-panel)')
  expect(styles).not.toContain('border-color var(--wren-border-strong)')
})

it('shows four privacy-safe recent entries and opens the complete activity view', () => {
  render(<ActivityHarness account={account} moduleId='activity' />)

  expect(screen.getAllByRole('listitem')).toHaveLength(4)
  expect(screen.getAllByText(/garden\.example/)).toHaveLength(4)
  expect(document.body.textContent).not.toContain(transactionHash)
  expect(document.body.textContent).not.toMatch(/payload|calldata|recipient/i)

  const continuation = screen.getByRole('button', { name: 'View all activity' })
  expect(continuation.classList.contains('accountContinuationRow')).toBe(true)
  fireEvent.click(continuation)
  expect(link.send).toHaveBeenCalledWith('nav:forward', 'panel', {
    view: 'expandedModule',
    data: { id: 'activity', account, title: 'Activity' }
  })
})

it('filters the complete history by authored activity families', () => {
  render(<ActivityHarness account={account} moduleId='activity' expanded />)

  expect(screen.getAllByRole('listitem')).toHaveLength(5)
  fireEvent.click(screen.getByRole('button', { name: 'Signatures' }))
  expect(screen.getAllByRole('listitem')).toHaveLength(1)
  expect(screen.getByText('Typed-data signature')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Connections' }))
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
  expect(screen.getByText('Account access')).toBeTruthy()
  expect(screen.getByText('Token addition')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Transactions' }))
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
})

it('never exposes a legacy transaction hash or an explorer action from private history', () => {
  render(<ActivityHarness account={account} moduleId='activity' expanded />)
  expect(document.body.textContent).not.toContain(transactionHash)
  expect(screen.queryByRole('button', { name: /block explorer/ })).toBeNull()
})

it('focuses the exact activity row requested by native notification navigation', () => {
  const selected = entries[2]
  render(
    <ActivityHarness
      account={account}
      moduleId='activity'
      expanded
      expandedData={{ activityId: selected.id }}
    />
  )

  expect(document.activeElement).toBe(screen.getAllByRole('listitem')[2])
  expect(document.activeElement.classList.contains('activityRowSelected')).toBe(true)
})

it('announces when notification navigation targets cleared history', () => {
  render(
    <ActivityHarness
      account={account}
      entries={[]}
      moduleId='activity'
      expanded
      expandedData={{ activityId: crypto.randomUUID() }}
    />
  )

  expect(screen.getByText('This activity is no longer in history.').getAttribute('role')).toBe('status')
})

it.each([
  ['submitted', 'Submitted', 'Sent to network'],
  ['confirming', 'Confirming', 'Included; waiting for final confirmation'],
  ['replaced', 'Replaced', 'A submitted wallet activity was replaced'],
  ['reorged', 'Reorg detected', 'A prior confirmation changed; Wren is checking again'],
  ['stopped', 'Monitoring stopped', 'The network may still process it.'],
  ['clearance-unverified', 'Clearance not verified', 'could not verify that the delegation is cleared'],
  ['verified-clearance', 'Delegation removed', 'no longer delegates execution']
])('presents the privacy-safe %s lifecycle state', (outcome, label, detail) => {
  render(
    <ActivityHarness
      account={account}
      entries={[entry({ type: 'eip7702Revoke', outcome, transactionHash: undefined })]}
      moduleId='activity'
      expanded
    />
  )
  expect(screen.getByText(label)).toBeTruthy()
  expect(screen.getByText(new RegExp(detail, 'i'))).toBeTruthy()
})

it('uses an explicit privacy-preserving empty state', () => {
  render(<ActivityHarness account={account} entries={[]} moduleId='activity' />)

  expect(screen.getByText('No activity yet')).toBeTruthy()
  expect(
    screen.getByText('Completed wallet requests will appear here without their private contents.')
  ).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'View all activity' })).toBeNull()
})

it('does not expose opaque origin identifiers as app names', () => {
  expect(activityOriginLabel('9d6ac046-3188-4eb3-9472-1cd540f61eae')).toBe('Unknown app')
  expect(activityOriginLabel('https://garden.example/private/path')).toBe('garden.example')
  expect(activityOriginLabel('opaque', 'Named app')).toBe('Named app')
})

it('presents deployment activity with its friendly name and never searches its private origin', () => {
  expect(activityOriginLabel(WREN_DEPLOY_ORIGIN)).toBe(WREN_DEPLOY_DISPLAY_NAME)
  expect(activityOriginLabel('managed-id', WREN_DEPLOY_ORIGIN)).toBe(WREN_DEPLOY_DISPLAY_NAME)

  const deploymentOriginId = originIdForInvoker(WREN_DEPLOY_ORIGIN, { provenance: 'managed' })
  expect(activityOriginLabel(deploymentOriginId)).toBe(WREN_DEPLOY_DISPLAY_NAME)

  const deployment = [entry({ origin: deploymentOriginId })]
  expect(filterActivity(deployment, 'transactions', 'Wren Deploy')).toHaveLength(1)
  expect(filterActivity(deployment, 'transactions', deploymentOriginId)).toHaveLength(0)
})

it('keeps keyword filtering within the selected family', () => {
  expect(filterActivity(entries, 'transactions', 'failed')).toHaveLength(1)
  expect(filterActivity(entries, 'signatures', 'failed')).toHaveLength(0)
})

it('clears all device activity through an explicit accessible confirmation', () => {
  render(<ActivityHarness account={account} moduleId='activity' expanded />)

  const clear = screen.getByRole('button', { name: 'Clear activity' })
  fireEvent.click(clear)

  const dialog = screen.getByRole('alertdialog', { name: 'Clear activity history?' })
  expect(dialog.textContent).toContain('every account on this device')
  expect(dialog.textContent).toContain('Pending activity may appear again')
  expect(dialog.textContent).toContain('local outbound-address memory')
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))

  fireEvent.keyDown(dialog, { key: 'Escape' })
  expect(screen.queryByRole('alertdialog')).toBeNull()
  const restoredClear = screen.getByRole('button', { name: 'Clear activity' })
  expect(document.activeElement).toBe(restoredClear)

  fireEvent.click(restoredClear)
  fireEvent.click(screen.getByRole('button', { name: 'Clear history' }))
  expect(link.send).toHaveBeenCalledWith('tray:action', 'clearActivity')
  expect(screen.getByRole('alertdialog').getAttribute('aria-busy')).toBe('true')
  expect(screen.getByRole('button', { name: 'Clearing…' }).disabled).toBe(true)
})

it('announces successful clearing after the persisted history is removed', () => {
  const view = render(<ActivityHarness account={account} entries={entries} moduleId='activity' expanded />)

  fireEvent.click(screen.getByRole('button', { name: 'Clear activity' }))
  fireEvent.click(screen.getByRole('button', { name: 'Clear history' }))
  view.rerender(<ActivityHarness account={account} entries={[]} moduleId='activity' expanded />)

  const status = screen.getByText('Activity history cleared.')
  expect(status.getAttribute('role')).toBe('status')
  expect(document.activeElement).toBe(status)
  expect(screen.queryByRole('button', { name: 'Clear activity' })).toBeNull()
})
