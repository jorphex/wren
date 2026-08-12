import { Dash } from '../../../app/dash/App'
import Dapps from '../../../app/dash/Dapps'
import link from '../../../resources/link'

jest.mock('../../../resources/link', () => ({ send: jest.fn() }))
jest.mock('../../../app/dash/Notify', () => () => null)
jest.mock('../../../app/dash/Settings', () => () => null)

beforeEach(() => link.send.mockReset())

it('renders the connected-app destination instead of falling through to the control center', () => {
  const dash = new Dash({})
  const data = { dappDetails: 'garden.example' }

  const view = dash.renderPanel('dapps', data)

  expect(view.type).toBe(Dapps)
  expect(view.props.data).toBe(data)
})

it('returns one dashboard level on Escape when navigation is active', () => {
  const dash = new Dash({})
  dash.store = jest.fn(() => [{ view: 'send', data: { step: 'assetPicker' } }])
  const event = { defaultPrevented: false, key: 'Escape', preventDefault: jest.fn() }

  dash.onKeyDown(event)

  expect(event.preventDefault).toHaveBeenCalled()
  expect(link.send).toHaveBeenCalledWith('tray:action', 'backDash')
})

it('closes the dashboard from its root on Escape', () => {
  const dash = new Dash({})
  dash.store = jest.fn(() => [])
  const event = { defaultPrevented: false, key: 'Escape', preventDefault: jest.fn() }

  dash.onKeyDown(event)

  expect(link.send).toHaveBeenCalledWith('tray:action', 'closeDash')
})

it('leaves an Escape event handled by a child untouched', () => {
  const dash = new Dash({})
  dash.store = jest.fn(() => [{ view: 'send', data: {} }])
  const event = { defaultPrevented: true, key: 'Escape', preventDefault: jest.fn() }

  dash.onKeyDown(event)

  expect(link.send).not.toHaveBeenCalled()
})
