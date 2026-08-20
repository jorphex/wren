import { Contracts } from '../../../../app/dash/Contracts'
import { fireEvent, render, screen } from '../../../componentSetup'

jest.mock(
  '../../../../app/dash/Deployment',
  () =>
    function DeploymentMock() {
      return <input aria-label='Deployment draft' defaultValue='' />
    }
)

jest.mock(
  '../../../../app/dash/ContractVerification',
  () =>
    function ContractVerificationMock({ data }) {
      return <input aria-label='Verification target' defaultValue={data?.address || ''} />
    }
)

it('defaults to deployment and preserves both independent drafts across mode switches', async () => {
  const { user } = render(<Contracts />)
  const deploy = screen.getByRole('button', { name: 'Deploy contract' })
  const verify = screen.getByRole('button', { name: 'Verify source' })

  expect(screen.getByRole('heading', { name: 'Contracts' })).toBeTruthy()
  expect(deploy.getAttribute('aria-pressed')).toBe('true')
  expect(verify.getAttribute('aria-pressed')).toBe('false')
  expect(screen.queryByLabelText('Verification target')).toBeNull()

  fireEvent.change(screen.getByLabelText('Deployment draft'), { target: { value: '0x6000' } })
  await user.click(verify)
  fireEvent.change(screen.getByLabelText('Verification target'), {
    target: { value: '0x1111111111111111111111111111111111111111' }
  })
  await user.click(deploy)

  expect(screen.getByLabelText('Deployment draft').value).toBe('0x6000')
  await user.click(verify)
  expect(screen.getByLabelText('Verification target').value).toBe(
    '0x1111111111111111111111111111111111111111'
  )
})

it('opens a confirmed-deployment handoff directly in Verify mode with its prefill intact', () => {
  const address = '0x2222222222222222222222222222222222222222'
  render(<Contracts initialMode='verify' data={{ mode: 'verify', chainId: 1, address }} />)

  expect(screen.getByRole('button', { name: 'Deploy contract' }).getAttribute('aria-pressed')).toBe('false')
  expect(screen.getByRole('button', { name: 'Verify source' }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByLabelText('Verification target').value).toBe(address)
  expect(screen.queryByLabelText('Deployment draft')).toBeNull()
})

it('accepts a new confirmed handoff while mounted without losing the deployment draft', async () => {
  const firstAddress = '0x3333333333333333333333333333333333333333'
  const nextAddress = '0x4444444444444444444444444444444444444444'
  const { rerender, user } = render(<Contracts data={{}} />)

  fireEvent.change(screen.getByLabelText('Deployment draft'), { target: { value: '0x6000' } })
  await user.click(screen.getByRole('button', { name: 'Verify source' }))
  fireEvent.change(screen.getByLabelText('Verification target'), { target: { value: firstAddress } })
  await user.click(screen.getByRole('button', { name: 'Deploy contract' }))

  rerender(
    <Contracts
      initialMode='verify'
      data={{
        mode: 'verify',
        operationId: '88888888-8888-4888-8888-888888888888',
        chainId: 1,
        address: nextAddress
      }}
    />
  )

  expect(screen.getByRole('button', { name: 'Verify source' }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByLabelText('Verification target').value).toBe(nextAddress)
  await user.click(screen.getByRole('button', { name: 'Deploy contract' }))
  expect(screen.getByLabelText('Deployment draft').value).toBe('0x6000')
})

it('uses the established quiet Send-style peer control without a primary action treatment', () => {
  render(<Contracts />)

  const switcher = screen.getByRole('group', { name: 'Contract tool' })
  expect(switcher.classList.contains('sendModeSwitch')).toBe(true)
  expect(switcher.classList.contains('contractsModeSwitch')).toBe(true)
  expect(switcher.querySelector('.wrenControlPrimary')).toBeNull()
})
