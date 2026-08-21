import Restore from 'react-restore'

import { Command } from '../../../../app/dash/Command'
import link from '../../../../resources/link'
import { fireEvent, render, screen } from '../../../componentSetup'

jest.mock('../../../../resources/link', () => ({ send: jest.fn() }))

const renderCommand = (nav) => {
  const store = Restore.create({ windows: { dash: { nav } } }, {})
  const ConnectedCommand = Restore.connect(Command, store)
  return render(<ConnectedCommand />)
}

it('uses the Contacts title and routes Back and Close actions', () => {
  renderCommand([{ view: 'addressBook', data: {} }])

  expect(screen.getByText('Contacts')).toBeTruthy()
  const back = screen.getByRole('button', { name: 'Back' })
  const close = screen.getByRole('button', { name: 'Close' })
  expect(back.classList.contains('wrenShellNav')).toBe(true)
  expect(close.classList.contains('wrenShellNav')).toBe(true)
  fireEvent.click(back)
  fireEvent.click(close)

  expect(link.send.mock.calls).toEqual([
    ['tray:action', 'backDash'],
    ['tray:action', 'closeDash']
  ])
})

it('hides Back at the dashboard root while retaining Close', () => {
  renderCommand([])

  expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
})

it('uses the active crumb title for a nested dashboard surface', () => {
  renderCommand([
    { view: 'send', data: { step: 'assetPicker', title: 'Choose an asset' } },
    { view: 'send', data: {} }
  ])

  expect(screen.getByText('Choose an asset')).toBeTruthy()
  expect(screen.getAllByRole('button', { name: 'Back' })).toHaveLength(1)
})

it('uses an authored title for the generic notice surface', () => {
  renderCommand([{ view: 'notify', data: { notify: 'gasFeeWarning' } }])

  expect(screen.getByText('Notice')).toBeTruthy()
  expect(screen.queryByText('notify')).toBeNull()
})

it('uses the authored App activity title', () => {
  renderCommand([{ view: 'dapps', data: {} }])

  expect(screen.getByText('App activity')).toBeTruthy()
  expect(screen.queryByText('dapps')).toBeNull()
})

it.each(['contracts', 'deployment', 'contractVerification'])(
  'uses the authored Contracts title for the %s route',
  (view) => {
    renderCommand([{ view, data: {} }])

    expect(screen.getByText('Contracts')).toBeTruthy()
    expect(screen.queryByText(view)).toBeNull()
  }
)
