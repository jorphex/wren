import ReactDOM from 'react-dom'
import Restore from 'react-restore'

import { act, render, screen } from '../../../../componentSetup'
import { Add } from '../../../../../app/dash/Accounts/Add'

jest.mock('react-dom', () => ({
  ...jest.requireActual('react-dom'),
  findDOMNode: jest.fn(() => {
    throw new Error('Transition fell back to findDOMNode')
  })
}))
jest.mock('../../../../../app/dash/Accounts/Add/AddHardware', () => () => null)
jest.mock('../../../../../app/dash/Accounts/Add/AddHardwareLattice', () => () => null)
jest.mock('../../../../../app/dash/Accounts/Add/AddPhrase', () => () => null)
jest.mock('../../../../../app/dash/Accounts/Add/AddRing', () => () => null)
jest.mock('../../../../../app/dash/Accounts/Add/AddAddress', () => () => null)

const store = Restore.create(
  { view: { addAccount: false } },
  {
    setAddAccount: (update, value) => update('view.addAccount', () => value)
  }
)
const ConnectedAdd = Restore.connect(Add, store)

beforeEach(() => {
  global.Worker = jest.fn(() => ({ postMessage: jest.fn() }))
  HTMLCanvasElement.prototype.transferControlToOffscreen = jest.fn(() => ({}))
})

afterEach(() => {
  store.setAddAccount(false)
  delete HTMLCanvasElement.prototype.transferControlToOffscreen
  delete global.Worker
})

it('enters through an explicit transition node without findDOMNode', () => {
  render(<ConnectedAdd close={jest.fn()} />)

  act(() => store.setAddAccount(true))
  act(() => jest.runAllTimers())

  expect(screen.getByText('Add account')).toBeTruthy()
  expect(ReactDOM.findDOMNode).not.toHaveBeenCalled()
})

it('exposes account setup as a keyboard control', async () => {
  const close = jest.fn()
  const { user } = render(<ConnectedAdd close={close} />)

  await user.tab()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add account' }))
  await user.keyboard('{Enter}')

  expect(close).toHaveBeenCalledTimes(1)
})
