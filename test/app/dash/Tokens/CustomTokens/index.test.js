import Restore from 'react-restore'

import { act, render, screen, waitFor, within } from '../../../../componentSetup'
import CustomTokensComponent from '../../../../../app/dash/Tokens/CustomTokens'
import link from '../../../../../resources/link'

jest.mock('../../../../../resources/link', () => ({ send: jest.fn() }))

const alpha = {
  address: '0x00000000000000000000000000000000000000AA',
  chainId: 1,
  decimals: 18,
  logoURI: 'https://assets.coingecko.com/alpha.png',
  name: 'Alpha Token',
  symbol: 'ALPHA'
}
const beta = {
  address: '0x00000000000000000000000000000000000000bb',
  chainId: 137,
  decimals: 6,
  logoURI: 'https://assets.coingecko.com/beta.png',
  name: 'Beta Token',
  symbol: 'BETA'
}

const renderTokens = (tokens = [alpha, beta]) => {
  const store = Restore.create(
    { main: { tokens: { custom: tokens } } },
    { setTokens: (update, nextTokens) => update('main.tokens.custom', () => nextTokens) }
  )
  const CustomTokens = Restore.connect(CustomTokensComponent, store)

  return { ...render(<CustomTokens />), store }
}

test('uses the canonical asset placeholder when a token has no logo', () => {
  renderTokens([{ ...alpha, logoURI: '' }])

  const mark = screen.getByRole('img', { name: 'ALPHA asset' })
  expect(mark.classList.contains('customTokensAssetMark')).toBe(true)
  expect(within(mark).getByText('A')).toBeTruthy()
  expect(within(mark).queryByRole('img')).toBeNull()
  expect(mark.querySelector('.assetMarkChain')).toBeNull()
})

test('exposes every token interaction as a keyboard-operable named button', async () => {
  const { user } = renderTokens([alpha])

  const expand = screen.getByRole('button', { name: 'Expand ALPHA token on chain 1' })
  expect(screen.queryByRole('button', { name: 'Copy ALPHA token address' })).toBeNull()
  await user.tab()
  expect(document.activeElement).toBe(expand)
  await user.keyboard('{Enter}')
  expect(screen.getByRole('button', { name: 'Collapse ALPHA token on chain 1' })).toBeTruthy()

  const copy = screen.getByRole('button', { name: 'Copy ALPHA token address' })
  const edit = screen.getByRole('button', { name: 'Edit ALPHA token' })
  const remove = screen.getByRole('button', { name: 'Remove ALPHA token' })
  expect([copy, edit, remove]).toHaveLength(3)
  expect([copy.disabled, edit.disabled, remove.disabled]).toEqual([false, false, false])

  copy.focus()
  await user.keyboard(' ')
  expect(link.send).toHaveBeenCalledWith('tray:clipboardData', alpha.address)
})

test('scopes copy feedback and timer resets to normalized token identity', async () => {
  const { store, user } = renderTokens()

  await user.click(screen.getByRole('button', { name: 'Expand ALPHA token on chain 1' }))
  await user.click(screen.getByRole('button', { name: 'Copy ALPHA token address' }))
  expect(screen.getByRole('button', { name: 'Copy ALPHA token address' }).textContent).toBe('Address Copied')
  expect(screen.getByRole('status').textContent).toBe('ALPHA token address copied')
  expect(screen.queryByRole('button', { name: 'Copy BETA token address' })).toBeNull()

  await user.click(screen.getByRole('button', { name: 'Expand BETA token on chain 137' }))
  expect(screen.getByRole('button', { name: 'Copy BETA token address' }).textContent).toBe(beta.address)
  await user.click(screen.getByRole('button', { name: 'Expand ALPHA token on chain 1' }))
  expect(screen.getByRole('button', { name: 'Copy ALPHA token address' }).textContent).toBe('Address Copied')

  act(() => jest.advanceTimersByTime(500))
  await user.click(screen.getByRole('button', { name: 'Copy ALPHA token address' }))

  act(() => store.setTokens([beta, { ...alpha, address: alpha.address.toLowerCase() }]))
  expect(screen.getByRole('button', { name: 'Copy ALPHA token address' }).textContent).toBe('Address Copied')

  act(() => jest.advanceTimersByTime(999))
  expect(screen.getByRole('button', { name: 'Copy ALPHA token address' }).textContent).toBe('Address Copied')
  act(() => jest.advanceTimersByTime(1))
  expect(screen.getByRole('button', { name: 'Copy ALPHA token address' }).textContent).toBe(
    alpha.address.toLowerCase()
  )
  expect(screen.getByRole('status').textContent).toBe('')
})

test('keeps expansion attached to identity when deterministic sorting changes position', async () => {
  const sameAddressDifferentChain = { ...alpha, chainId: 10, name: 'Alpha Ten', symbol: 'TEN' }
  const { store, user } = renderTokens([sameAddressDifferentChain, alpha])

  await user.click(screen.getByRole('button', { name: 'Expand TEN token on chain 10' }))
  act(() => {
    store.setTokens([sameAddressDifferentChain, { ...alpha, chainId: 20 }])
    jest.advanceTimersByTime(0)
  })

  expect(screen.getByRole('button', { name: 'Collapse TEN token on chain 10' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Expand ALPHA token on chain 20' })).toBeTruthy()
})

test('preserves the edit navigation payload', async () => {
  const { user } = renderTokens([alpha])

  await user.click(screen.getByRole('button', { name: 'Expand ALPHA token on chain 1' }))
  await user.dblClick(screen.getByRole('button', { name: 'Edit ALPHA token' }))

  expect(link.send).toHaveBeenCalledTimes(1)
  expect(link.send).toHaveBeenCalledWith('nav:forward', 'dash', {
    view: 'tokens',
    data: {
      notify: 'addToken',
      notifyData: {
        error: null,
        isEdit: true,
        address: alpha.address,
        chain: { id: alpha.chainId },
        tokenData: alpha
      }
    }
  })
})

test('stages removal, focuses the safe action, and deduplicates confirmation', async () => {
  const { store, user } = renderTokens()
  await user.click(screen.getByRole('button', { name: 'Expand ALPHA token on chain 1' }))
  const alphaRemove = screen.getByRole('button', { name: 'Remove ALPHA token' })

  await user.click(alphaRemove)
  const dialog = screen.getByRole('alertdialog', { name: 'Remove ALPHA?' })
  expect(dialog.getAttribute('aria-modal')).toBeNull()
  expect(screen.getByText('Remove ALPHA?')).toBeTruthy()
  expect(
    screen.getByText('This removes the custom token from Wren. On-chain assets are not affected.')
  ).toBeTruthy()
  const cancel = screen.getByRole('button', { name: 'Cancel' })
  expect(document.activeElement).toBe(cancel)
  await user.keyboard('{Escape}')
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove ALPHA token' }))
  await user.click(screen.getByRole('button', { name: 'Remove ALPHA token' }))
  expect(screen.getByRole('button', { name: 'Expand BETA token on chain 137' }).disabled).toBe(true)
  const confirm = screen.getByRole('button', { name: 'Remove token' })
  await user.dblClick(confirm)
  expect(confirm.disabled).toBe(true)
  act(() => jest.advanceTimersByTime(99))
  expect(link.send).not.toHaveBeenCalled()
  act(() => jest.advanceTimersByTime(1))

  expect(link.send).toHaveBeenCalledTimes(1)
  expect(link.send).toHaveBeenCalledWith('tray:removeToken', alpha)

  act(() => store.setTokens([beta]))
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Expand BETA token on chain 137' })
    )
  )
  await user.click(screen.getByRole('button', { name: 'Expand BETA token on chain 137' }))
  expect(screen.getByRole('button', { name: 'Remove BETA token' }).disabled).toBe(false)
})

test('cancels pending copy and remove work on unmount', async () => {
  const { unmount, user } = renderTokens([alpha])

  await user.click(screen.getByRole('button', { name: 'Expand ALPHA token on chain 1' }))
  await user.click(screen.getByRole('button', { name: 'Copy ALPHA token address' }))
  await user.click(screen.getByRole('button', { name: 'Remove ALPHA token' }))
  await user.click(screen.getByRole('button', { name: 'Remove token' }))
  link.send.mockClear()
  unmount()
  act(() => jest.runAllTimers())

  expect(link.send).not.toHaveBeenCalled()
})
