import link from '../../../../../resources/link'

import { fireEvent, render, screen } from '../../../../componentSetup'

import Slides from '../../../../../app/onboard/App/Slides'

jest.mock('../../../../../resources/link', () => ({
  send: jest.fn()
}))

it.each([
  ['Create wallet', { newAccountType: 'create-seed' }],
  ['Import wallet', { accountChooserMode: 'import' }],
  ['Connect hardware wallet', { accountChooserMode: 'hardware' }],
  ['Watch address', { newAccountType: 'nonsigning' }]
])('starts %s directly', (label, data) => {
  link.send.mockClear()
  render(<Slides />)
  fireEvent.click(screen.getByRole('button', { name: label }))
  expect(link.send.mock.calls).toEqual([
    ['tray:action', 'navReplace', 'dash', [{ view: 'accounts', data: { showAddAccounts: true, ...data } }]],
    ['frame:close']
  ])
})
