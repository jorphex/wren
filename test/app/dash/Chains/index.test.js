import { Settings } from '../../../../app/dash/Chains'
import { ChainHeader } from '../../../../app/dash/Chains/Chain/Components'
import { WREN_SUPPORT_URL } from '../../../../resources/constants'
import link from '../../../../resources/link'
import { render, screen } from '../../../componentSetup'

jest.mock('../../../../resources/link', () => ({ send: jest.fn() }))
jest.mock('../../../../resources/Components/RingIcon', () => () => null)

class ChainsHarness extends Settings {
  store(...path) {
    const key = path.join('.')
    if (key === 'main.networks' || key === 'main.networksMeta') return {}
  }
}

test('opens GitHub Issues from native keyboard input', async () => {
  const { user } = render(<ChainsHarness data={{}} />)
  const support = screen.getByRole('button', { name: /need help.*open github issues/i })

  support.focus()
  await user.keyboard('{Enter}')

  expect(link.send).toHaveBeenCalledWith('tray:openExternal', WREN_SUPPORT_URL)
})

test('renders network identity without an invalid custom ARIA role', () => {
  render(
    <ChainHeader
      type='ethereum'
      id={1}
      name='Ethereum'
      isTestnet={false}
      on={true}
      showExpand={false}
      showToggle={false}
    />
  )

  const identity = screen.getByText('Ethereum')
  expect(identity.tagName).toBe('SPAN')
  expect(identity.getAttribute('role')).toBeNull()
})
