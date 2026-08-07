import { Settings } from '../../../../app/dash/Chains'
import { WREN_SUPPORT_URL } from '../../../../resources/constants'
import link from '../../../../resources/link'
import { render, screen } from '../../../componentSetup'

jest.mock('../../../../resources/link', () => ({ send: jest.fn() }))

class ChainsHarness extends Settings {
  store(...path) {
    const key = path.join('.')
    if (key === 'main.networks' || key === 'main.networksMeta') return {}
  }
}

test('opens community support from native keyboard input', async () => {
  const { user } = render(<ChainsHarness data={{}} />)
  const support = screen.getByRole('button', { name: /open a community support issue/i })

  support.focus()
  await user.keyboard('{Enter}')

  expect(link.send).toHaveBeenCalledWith('tray:openExternal', WREN_SUPPORT_URL)
})
