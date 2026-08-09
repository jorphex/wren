import Restore from 'react-restore'

import { act, screen, render, waitFor } from '../../../../componentSetup'
import store from '../../../../../main/store'
import link from '../../../../../resources/link'
import AddTokenComponent from '../../../../../app/dash/Tokens/AddToken'

jest.mock('../../../../../main/store/persist')
jest.mock('../../../../../resources/link', () => ({
  invoke: jest.fn().mockResolvedValue({}),
  send: jest.fn()
}))

const AddToken = Restore.connect(AddTokenComponent, store)

beforeAll(() => {
  store.addNetwork({
    id: 1,
    type: 'ethereum',
    name: 'Mainnet',
    explorer: 'https://etherscan.io',
    symbol: 'ETH',
    on: true
  })

  store.setEndpoint('ethereum', 1, 'rpc-1', { connected: false })
  store.activateNetwork('ethereum', 1, true)

  store.removeNetwork({ type: 'ethereum', id: 137 })
  store.addNetwork({
    id: 137,
    type: 'ethereum',
    name: 'Polygon',
    explorer: 'https://polygonscan.com',
    symbol: 'MATIC',
    on: true,
    primaryColor: 'accent7'
  })

  store.setEndpoint('ethereum', 137, 'rpc-1', { connected: false })
  store.activateNetwork('ethereum', 137, true)
})

describe('selecting token chain', () => {
  it('should display the expected chain IDs', () => {
    render(<AddToken />)

    const tokenChainNames = screen
      .getAllByRole('button')
      .filter((el) => el.classList.contains('originChainItem'))
      .map((el) => el.textContent)
    expect(tokenChainNames).toEqual(['Mainnet', 'Polygon'])
  })

  it('should update add token navigation when a chain is selected', async () => {
    // 200 ms UI delay after clicking the button to select a chain
    const { user } = render(<AddToken />, { advanceTimersAfterInput: true })

    const polygonButton = screen.getByRole('button', { name: 'Polygon' })
    await user.click(polygonButton)

    expect(link.send).toHaveBeenCalledWith('tray:action', 'navDash', {
      view: 'tokens',
      data: {
        notify: 'addToken',
        notifyData: {
          chain: {
            id: 137,
            name: 'Polygon',
            color: 'accent7'
          }
        }
      }
    })
  })

  it('cancels delayed chain navigation when the selector unmounts', async () => {
    const { unmount, user } = render(<AddToken />)

    const polygonButton = screen.getByRole('button', { name: 'Polygon' })
    polygonButton.focus()
    await user.keyboard('{Enter}')
    unmount()
    act(() => jest.advanceTimersByTime(200))

    expect(link.send).not.toHaveBeenCalled()
  })

  it('selects a chain only once for duplicate activation', async () => {
    const { user } = render(<AddToken />, { advanceTimersAfterInput: true })

    await user.dblClick(screen.getByRole('button', { name: 'Polygon' }))

    expect(link.send.mock.calls.filter(([channel]) => channel === 'tray:action')).toHaveLength(1)
  })

  it('does not let alternate chain navigation race a pending selection', async () => {
    const { user } = render(<AddToken />)

    await user.click(screen.getByRole('button', { name: 'Polygon' }))
    const enableChains = screen.getByRole('button', { name: 'Enable it in Chains' })
    expect(enableChains.disabled).toBe(true)
    enableChains.click()
    act(() => jest.advanceTimersByTime(200))

    expect(link.send.mock.calls).toEqual([
      [
        'tray:action',
        'navDash',
        {
          view: 'tokens',
          data: {
            notify: 'addToken',
            notifyData: { chain: { id: 137, name: 'Polygon', color: 'accent7' } }
          }
        }
      ]
    ])
  })

  it('opens chain settings only once for duplicate activation', async () => {
    const { user } = render(<AddToken />)

    await user.dblClick(screen.getByRole('button', { name: 'Enable it in Chains' }))

    expect(link.send.mock.calls).toEqual([['tray:action', 'navDash', { view: 'chains', data: {} }]])
  })
})

describe('setting token address', () => {
  it('should prompt for a contract address if a chain has been selected', () => {
    render(<AddToken data={{ notifyData: { chain: { id: 137 } } }} />)

    const contractAddressInput = screen.getByLabelText(`Enter token's address`)
    expect(contractAddressInput.textContent).toBe('')
  })

  it('should update add token navigation with an error when a user submits an invalid contract address', async () => {
    const { user } = render(<AddToken data={{ notifyData: { chain: { id: 1 } } }} />)

    const contractAddressInput = screen.getByLabelText(`Enter token's address`)
    await user.type(contractAddressInput, 'INVALID_ADDRESS')
    const setAddressButton = screen.getByRole('button', { name: 'Set Address' })
    await user.click(setAddressButton)

    expect(link.send).toHaveBeenCalledTimes(1)
    expect(link.send).toHaveBeenCalledWith('nav:forward', 'dash', {
      view: 'tokens',
      data: {
        notify: 'addToken',
        notifyData: {
          chain: { id: 1 },
          address: 'INVALID_ADDRESS',
          error: 'INVALID CONTRACT ADDRESS'
        }
      }
    })
  })

  it('should update add token navigation when a contracts details cannot be validated on-chain', async () => {
    store.setEndpoint('ethereum', 1, 'rpc-1', { connected: true })
    link.invoke.mockImplementationOnce((action, address, chainId) => {
      expect(action).toBe('tray:getTokenDetails')
      expect(address).toBe('0x3432b6a60d23ca0dfca7761b7ab56459d9c964d0')
      expect(chainId).toBe(1)
      return {
        decimals: 0,
        name: '',
        symbol: '',
        totalSupply: ''
      }
    })

    const { user } = render(<AddToken data={{ notifyData: { chain: { id: 1 } } }} />)

    const contractAddressLabel = screen.getByLabelText(`Enter token's address`)
    await user.type(contractAddressLabel, '0x3432b6a60d23ca0dfca7761b7ab56459d9c964d0')
    const setAddressButton = screen.getByRole('button', { name: 'Set Address' })
    await user.click(setAddressButton)

    expect(link.send).toHaveBeenCalledTimes(1)
    expect(link.send).toHaveBeenCalledWith('nav:forward', 'dash', {
      view: 'tokens',
      data: {
        notify: 'addToken',
        notifyData: {
          chain: { id: 1 },
          address: '0x3432b6a60d23ca0dfca7761b7ab56459d9c964d0',
          error: `COULD NOT FIND TOKEN WITH ADDRESS 0x3432b6a60d23ca0dfca7761b7ab56459d9c964d0`,
          tokenData: {
            decimals: 0,
            name: '',
            symbol: '',
            totalSupply: ''
          }
        }
      }
    })
  })

  it('should update add token navigation with the contract details when a valid address is entered for a connected chain', async () => {
    const mockTokenData = {
      decimals: 420,
      name: 'FAKE COIN',
      symbol: 'FAKE',
      totalSupply: '100000'
    }

    link.invoke.mockImplementationOnce((action, address, chainId) => {
      expect(action).toBe('tray:getTokenDetails')
      expect(address).toBe('0x3432b6a60d23ca0dfca7761b7ab56459d9c964d0')
      expect(chainId).toBe(1)
      return mockTokenData
    })

    const { user } = render(<AddToken data={{ notifyData: { chain: { id: 1 } } }} />)

    const contractAddressLabel = screen.getByLabelText(`Enter token's address`)
    await user.type(contractAddressLabel, '0x3432b6a60d23ca0dfca7761b7ab56459d9c964d0')
    const setAddressButton = screen.getByRole('button', { name: 'Set Address' })
    await user.click(setAddressButton)

    expect(link.send).toHaveBeenCalledTimes(1)
    expect(link.send).toHaveBeenCalledWith('nav:forward', 'dash', {
      view: 'tokens',
      data: {
        notify: 'addToken',
        notifyData: {
          error: null,
          chain: { id: 1 },
          address: '0x3432b6a60d23ca0dfca7761b7ab56459d9c964d0',
          tokenData: mockTokenData
        }
      }
    })
  })

  it('submits only one token lookup for duplicate activation', async () => {
    let resolveLookup
    link.invoke.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLookup = resolve
      })
    )
    const { user } = render(<AddToken data={{ notifyData: { chain: { id: 1 } } }} />)
    const input = screen.getByLabelText(`Enter token's address`)
    await user.type(input, '0x3432b6a60d23ca0dfca7761b7ab56459d9c964d0')

    await user.dblClick(screen.getByRole('button', { name: 'Set Address' }))

    expect(link.invoke).toHaveBeenCalledTimes(1)
    await act(async () => resolveLookup({ totalSupply: '1' }))
  })

  it('does not navigate with a token lookup result after unmount', async () => {
    let resolveLookup
    link.invoke.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLookup = resolve
      })
    )
    const { unmount, user } = render(<AddToken data={{ notifyData: { chain: { id: 1 } } }} />)
    await user.type(
      screen.getByLabelText(`Enter token's address`),
      '0x3432b6a60d23ca0dfca7761b7ab56459d9c964d0'
    )
    await user.click(screen.getByRole('button', { name: 'Set Address' }))

    unmount()
    await act(async () => resolveLookup({ totalSupply: '1' }))

    expect(link.send).not.toHaveBeenCalled()
  })

  it('does not navigate with a lookup result from a previously selected chain', async () => {
    let resolveLookup
    link.invoke.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLookup = resolve
      })
    )
    const { rerender, user } = render(<AddToken data={{ notifyData: { chain: { id: 1 } } }} />)
    await user.type(
      screen.getByLabelText(`Enter token's address`),
      '0x3432b6a60d23ca0dfca7761b7ab56459d9c964d0'
    )
    await user.click(screen.getByRole('button', { name: 'Set Address' }))

    rerender(<AddToken data={{ notifyData: { chain: { id: 137 } } }} />)
    await act(async () => resolveLookup({ totalSupply: '1' }))

    expect(link.send).not.toHaveBeenCalled()
    expect(screen.getByLabelText(`Enter token's address`).value).toBe('')
  })

  it('routes failed token lookups to the manual metadata flow', async () => {
    link.invoke.mockRejectedValueOnce(new Error('RPC unavailable'))
    const address = '0x3432b6a60d23ca0dfca7761b7ab56459d9c964d0'
    const { user } = render(<AddToken data={{ notifyData: { chain: { id: 1 } } }} />)
    await user.type(screen.getByLabelText(`Enter token's address`), address)

    await user.click(screen.getByRole('button', { name: 'Set Address' }))

    expect(link.send).toHaveBeenCalledWith('nav:forward', 'dash', {
      view: 'tokens',
      data: {
        notify: 'addToken',
        notifyData: {
          chain: { id: 1 },
          address,
          error: `COULD NOT FIND TOKEN WITH ADDRESS ${address}`,
          tokenData: {}
        }
      }
    })
  })
})

describe('displaying errors', () => {
  it('should allow the user to navigate back when displaying an error', () => {
    render(
      <AddToken
        data={{ notifyData: { chain: { id: 137 }, error: 'INVALID CONTRACT ADDRESS', address: '0xabc' } }}
      />
    )

    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBe(1)
    expect(buttons[0].textContent).toBe('BACK')
  })

  it(`should allow the user to proceed if we are unable to verify the token data`, () => {
    render(
      <AddToken
        data={{
          notifyData: {
            chain: { id: 137 },
            error: `COULD NOT FIND TOKEN WITH ADDRESS BLAH BLAH`,
            address: '0xabc'
          }
        }}
      />
    )

    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBe(2)
    expect(buttons[0].textContent).toBe('BACK')
    expect(buttons[1].textContent).toBe('ADD ANYWAY')
  })

  it('sends the exact back navigation from an invalid-address error', async () => {
    const { user } = render(
      <AddToken
        data={{ notifyData: { chain: { id: 137 }, error: 'INVALID CONTRACT ADDRESS', address: '0xabc' } }}
      />
    )

    await user.click(screen.getByRole('button', { name: 'BACK' }))

    expect(link.send.mock.calls).toEqual([['nav:back', 'dash', 1]])
  })

  it('sends the exact manual-entry navigation when adding an unverified token', async () => {
    const chain = { id: 137 }
    const address = '0xabc'
    const { user } = render(
      <AddToken
        data={{
          notifyData: {
            chain,
            error: `COULD NOT FIND TOKEN WITH ADDRESS ${address}`,
            address
          }
        }}
      />
    )

    await user.click(screen.getByRole('button', { name: 'ADD ANYWAY' }))

    expect(link.send.mock.calls).toEqual([
      ['nav:back', 'dash', 1],
      [
        'nav:forward',
        'dash',
        { view: 'tokens', data: { notify: 'addToken', notifyData: { address, chain } } }
      ]
    ])
  })
})

describe('setting token details', () => {
  it('should show the user that they are editing a token', () => {
    render(
      <AddToken
        data={{
          notifyData: {
            chain: { id: 1 },
            address: '0x64aa3364F17a4D01c6f1751Fd97C2BD3D7e7f1D4',
            isEdit: true,
            tokenData: {
              decimals: 12,
              symbol: 'FAKE',
              name: 'FAKE',
              address: '0x64aa3364F17a4D01c6f1751Fd97C2BD3D7e7f1D4',
              totalSupply: '100'
            }
          }
        }}
      />
    )

    const heading = screen.getByTestId('addTokenFormTitle')
    const button = screen.getByRole('button')
    expect(heading.textContent).toBe('Edit Token')
    expect(button.textContent).toBe('Save')
  })

  it('should show the user that they are adding a token', () => {
    render(
      <AddToken
        data={{
          notifyData: { chain: { id: 1 }, address: '0x64aa3364F17a4D01c6f1751Fd97C2BD3D7e7f1D4' }
        }}
      />
    )

    const heading = screen.getByTestId('addTokenFormTitle')
    expect(heading.textContent).toBe('Add New Token')
  })

  it('should prompt to fill in missing token data', () => {
    render(
      <AddToken
        data={{
          notifyData: { chain: { id: 1 }, address: '0x64aa3364F17a4D01c6f1751Fd97C2BD3D7e7f1D4' }
        }}
      />
    )

    const button = screen.getByRole('button')
    expect(button.textContent).toBe('Fill in Token Details')
  })

  it('should show defaults in fields where token data is missing', () => {
    render(
      <AddToken
        data={{ notifyData: { chain: { id: 137 }, address: '0x64aa3364F17a4D01c6f1751Fd97C2BD3D7e7f1D4' } }}
      />
    )

    const contractAddressInput = screen.getByRole('heading')
    const tokenNameInput = screen.getByLabelText('Token Name')
    const tokenSymbolInput = screen.getByLabelText('Symbol')
    const tokenDecimalsInput = screen.getByLabelText('Decimals')

    expect(contractAddressInput.textContent).toEqual('0x64aa3364D7e7f1D4')
    expect(tokenNameInput.value).toEqual('Token Name')
    expect(tokenSymbolInput.value).toEqual('Symbol')
    expect(tokenDecimalsInput.value).toEqual('?')
  })

  it('should populate fields with token data', async () => {
    store.setEndpoint('ethereum', 137, 'rpc-1', { connected: true })

    const mockToken = { name: 'Frame Test on Polygon', symbol: 'mFRT', decimals: 18, totalSupply: '1066' }

    render(
      <AddToken
        data={{
          notifyData: {
            chain: { id: 1 },
            address: '0x64aa3364F17a4D01c6f1751Fd97C2BD3D7e7f1D4',
            tokenData: mockToken
          }
        }}
      />
    )

    const contractAddressInput = screen.getByRole('heading')
    const tokenNameInput = screen.getByLabelText('Token Name')
    const tokenSymbolInput = screen.getByLabelText('Symbol')
    const tokenDecimalsInput = screen.getByLabelText('Decimals')

    expect(contractAddressInput.textContent).toEqual('0x64aa3364D7e7f1D4')
    await waitFor(() => expect(tokenNameInput.value).toEqual('Frame Test on Polygon'), { timeout: 200 })
    expect(tokenSymbolInput.value).toEqual('mFRT')
    expect(tokenDecimalsInput.value).toEqual('18')
  })

  it('keeps the prefilled metadata form in normal forward and reverse tab order', async () => {
    const tokenData = {
      name: 'Test Token',
      symbol: 'TEST',
      decimals: 6,
      logoURI: 'https://example.test/token.png'
    }
    const { user } = render(
      <AddToken
        data={{
          notifyData: {
            address: '0x64aa3364F17a4D01c6f1751Fd97C2BD3D7e7f1D4',
            chain: { id: 1 },
            tokenData
          }
        }}
      />
    )

    const fields = [
      screen.getByLabelText('Token Name'),
      screen.getByLabelText('Symbol'),
      screen.getByLabelText('Decimals'),
      screen.getByLabelText('Logo URI'),
      screen.getByRole('button', { name: 'Add Token' })
    ]
    for (const field of fields) {
      await user.tab()
      expect(document.activeElement).toBe(field)
    }
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(fields[3])
  })

  it('settles a reviewed asset suggestion only when the token is saved', async () => {
    const requestReference = {
      account: '0x0000000000000000000000000000000000000001',
      handlerId: '11111111-1111-4111-8111-111111111111'
    }
    const tokenData = { name: 'Test Token', symbol: 'TEST', decimals: 6, logoURI: '' }
    const address = '0x64aa3364F17a4D01c6f1751Fd97C2BD3D7e7f1D4'
    const { user } = render(
      <AddToken
        data={{
          notifyData: {
            address,
            chain: { id: 1, name: 'Mainnet' },
            requestReference,
            tokenData
          }
        }}
      />,
      { advanceTimersAfterInput: true }
    )

    await user.click(screen.getByRole('button', { name: 'Add Token' }))

    expect(link.send).toHaveBeenCalledWith(
      'tray:addToken',
      { ...tokenData, address, chainId: 1 },
      requestReference
    )
  })

  it('accepts and preserves zero token decimals', async () => {
    const tokenData = { name: 'Whole Token', symbol: 'WHOLE', decimals: 0, logoURI: '' }
    const address = '0x64aa3364F17a4D01c6f1751Fd97C2BD3D7e7f1D4'
    const { user } = render(<AddToken data={{ notifyData: { address, chain: { id: 1 }, tokenData } }} />, {
      advanceTimersAfterInput: true
    })

    expect(screen.getByLabelText('Decimals').value).toBe('0')
    await user.click(screen.getByRole('button', { name: 'Add Token' }))
    expect(link.send).toHaveBeenCalledWith('tray:addToken', { ...tokenData, address, chainId: 1 }, undefined)
  })

  it('saves only once for duplicate activation', async () => {
    const tokenData = { name: 'Test Token', symbol: 'TEST', decimals: 6, logoURI: '' }
    const address = '0x64aa3364F17a4D01c6f1751Fd97C2BD3D7e7f1D4'
    const { user } = render(<AddToken data={{ notifyData: { address, chain: { id: 1 }, tokenData } }} />)

    await user.dblClick(screen.getByRole('button', { name: 'Add Token' }))

    expect(link.send.mock.calls.filter(([channel]) => channel === 'tray:addToken')).toHaveLength(1)
  })

  it('cancels delayed post-save navigation after unmount', async () => {
    const tokenData = { name: 'Test Token', symbol: 'TEST', decimals: 6, logoURI: '' }
    const address = '0x64aa3364F17a4D01c6f1751Fd97C2BD3D7e7f1D4'
    const { unmount, user } = render(
      <AddToken data={{ notifyData: { address, chain: { id: 1 }, tokenData } }} />
    )

    await user.click(screen.getByRole('button', { name: 'Add Token' }))
    unmount()
    act(() => jest.advanceTimersByTime(250))

    expect(link.send.mock.calls).toEqual([
      ['tray:addToken', { ...tokenData, address, chainId: 1 }, undefined]
    ])
  })

  it.each([
    ['add', false, 4, 'Add Token'],
    ['edit', true, 2, 'Save']
  ])(
    'uses the exact successful post-save navigation for %s',
    async (_label, isEdit, backSteps, buttonName) => {
      const tokenData = { name: 'Test Token', symbol: 'TEST', decimals: 6, logoURI: '' }
      const address = '0x64aa3364F17a4D01c6f1751Fd97C2BD3D7e7f1D4'
      const { user } = render(
        <AddToken data={{ notifyData: { address, chain: { id: 1 }, isEdit, tokenData } }} />
      )

      await user.click(screen.getByRole('button', { name: buttonName }))
      act(() => jest.advanceTimersByTime(250))

      expect(link.send.mock.calls).toEqual([
        ['tray:addToken', { ...tokenData, address, chainId: 1 }, undefined],
        ['nav:back', 'dash', backSteps],
        ['nav:forward', 'dash', { view: 'tokens', data: {} }]
      ])
    }
  )
})
