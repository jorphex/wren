import { MainnetDisconnected } from '../../../app/dapp/App'
import link from '../../../resources/link'
import { act, render, screen } from '../../componentSetup'

jest.mock('../../../resources/link', () => ({ send: jest.fn() }))

it('opens network settings before closing the built-in dapp window', async () => {
  const { user } = render(<MainnetDisconnected />)

  const viewNetworks = screen.getByRole('button', { name: 'View Networks' })
  expect(viewNetworks.classList.contains('wrenControlPrimary')).toBe(true)
  await user.click(viewNetworks)

  const openingButton = screen.getByRole('button', { name: 'Opening Networks…' })
  expect(openingButton.disabled).toBe(true)
  await user.click(openingButton)

  expect(link.send).toHaveBeenCalledTimes(1)
  expect(link.send).toHaveBeenCalledWith('tray:action', 'navDash', { view: 'chains', data: {} })

  act(() => jest.advanceTimersByTime(99))
  expect(link.send).toHaveBeenCalledTimes(1)

  act(() => jest.advanceTimersByTime(1))
  expect(link.send.mock.calls).toEqual([
    ['tray:action', 'navDash', { view: 'chains', data: {} }],
    ['frame:close']
  ])
})
