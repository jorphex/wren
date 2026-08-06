import { render, screen } from '../../../../componentSetup'
import { DappDetails } from '../../../../../app/dash/Dapps/DappDetails'

jest.mock(
  '../../../../../resources/Components/RingIcon',
  () =>
    function MockRingIcon() {
      return <span />
    }
)

class DappDetailsHarness extends DappDetails {
  store(...path) {
    const key = path.join('.')
    if (key === 'main.origins.origin') return { chain: { id: 1 }, name: 'example.test' }
    if (key === 'main.networks.ethereum') return { 1: { on: true } }
    if (key === 'main.networks.ethereum.1.on') return true
    if (key === 'main.networks.ethereum.1') return { id: 1, name: 'Ethereum', on: true }
    if (key === 'main.networksMeta.ethereum.1') return { primaryColor: 'accent1' }
  }
}

test('announces the selected default network', () => {
  render(<DappDetailsHarness originId='origin' />)

  expect(screen.getByRole('button', { name: 'Ethereum' }).getAttribute('aria-pressed')).toBe('true')
})
