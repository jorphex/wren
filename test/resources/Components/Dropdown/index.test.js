import Dropdown from '../../../../resources/Components/Dropdown'
import { render, screen } from '../../../componentSetup'

const options = [
  { text: 'Dark', value: 'dark' },
  { text: 'Light', value: 'light' }
]

it('exposes the full selected label through a native combobox', () => {
  render(<Dropdown label='Theme' options={options} syncValue='dark' onChange={jest.fn()} />)

  expect(screen.getByRole('combobox', { name: 'Theme' }).value).toBe('dark')
  expect(screen.getByRole('option', { name: 'Dark' }).selected).toBe(true)
})

it('tracks a changed synchronized value without emitting a user change', () => {
  const onChange = jest.fn()
  const { rerender } = render(
    <Dropdown label='Theme' options={options} syncValue='dark' onChange={onChange} />
  )

  rerender(<Dropdown label='Theme' options={options} syncValue='light' onChange={onChange} />)

  expect(screen.getByRole('option', { name: 'Light' }).selected).toBe(true)
  expect(onChange).not.toHaveBeenCalled()
})

it('emits a newly selected value once', async () => {
  const onChange = jest.fn()
  const { user } = render(<Dropdown label='Theme' options={options} syncValue='dark' onChange={onChange} />)

  await user.selectOptions(screen.getByRole('combobox', { name: 'Theme' }), 'light')

  expect(onChange).toHaveBeenCalledTimes(1)
  expect(onChange).toHaveBeenCalledWith('light')
})

it('preserves non-string option values', async () => {
  const onChange = jest.fn()
  const { user } = render(
    <Dropdown
      label='Limit'
      options={[
        { text: 'Five', value: 5 },
        { text: 'Ten', value: 10 }
      ]}
      syncValue={5}
      onChange={onChange}
    />
  )

  await user.selectOptions(screen.getByRole('combobox', { name: 'Limit' }), '10')

  expect(onChange).toHaveBeenCalledWith(10)
})
