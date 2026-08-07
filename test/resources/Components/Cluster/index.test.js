import { render, screen } from '../../../componentSetup'
import { Cluster, ClusterRow, ClusterStatus, ClusterValue } from '../../../../resources/Components/Cluster'

test('keeps display-only and falsey-action cluster values out of the interaction tree', () => {
  render(
    <Cluster>
      <ClusterRow>
        <ClusterValue>Current value</ClusterValue>
        <ClusterValue onClick={false}>Unavailable action</ClusterValue>
      </ClusterRow>
    </Cluster>
  )

  expect(screen.queryByRole('button')).toBeNull()
  expect(screen.getByText('Current value').tagName).toBe('DIV')
})

test('activates actionable cluster values with native keyboard behavior', async () => {
  const onClick = jest.fn()
  const onSubmit = jest.fn((event) => event.preventDefault())
  const { user } = render(
    <form onSubmit={onSubmit}>
      <Cluster>
        <ClusterRow>
          <ClusterValue ariaLabel='Review request' onClick={onClick}>
            <div>Review request</div>
          </ClusterValue>
        </ClusterRow>
      </Cluster>
    </form>
  )

  const button = screen.getByRole('button', { name: 'Review request' })
  await user.tab()
  expect(document.activeElement).toBe(button)
  await user.keyboard('{Enter}')
  await user.keyboard(' ')

  expect(onClick).toHaveBeenCalledTimes(2)
  expect(onSubmit).not.toHaveBeenCalled()
  expect(button.type).toBe('button')
  expect(button.querySelector('div')).toBeNull()
  const visibleContent = button.parentElement.querySelector('.clusterValueContent')
  expect(visibleContent.querySelector(':scope > div')).toBeTruthy()
  expect(visibleContent.getAttribute('aria-hidden')).toBeNull()
})

test('exposes explicit disclosure state and native disabled behavior', async () => {
  const onClick = jest.fn()
  const { user } = render(
    <Cluster>
      <ClusterRow>
        <ClusterValue ariaLabel='Expand RPC details' ariaExpanded={false} disabled onClick={onClick}>
          RPC
        </ClusterValue>
      </ClusterRow>
    </Cluster>
  )

  const button = screen.getByRole('button', { name: 'Expand RPC details' })
  expect(button.getAttribute('aria-expanded')).toBe('false')
  expect(button.disabled).toBe(true)
  await user.click(button)
  expect(onClick).not.toHaveBeenCalled()
})

test('keeps a polite status region mounted before its message changes', () => {
  const { rerender } = render(<ClusterStatus>{''}</ClusterStatus>)
  const status = screen.getByRole('status')

  expect(status.textContent).toBe('')
  rerender(<ClusterStatus>Address copied</ClusterStatus>)

  expect(screen.getByRole('status')).toBe(status)
  expect(status.textContent).toBe('Address copied')
})
