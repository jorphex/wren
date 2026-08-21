import { act, render, screen } from '../../../componentSetup'
import EditTokenSpend from '../../../../resources/Components/EditTokenSpend'
import link from '../../../../resources/link'
import BigNumber from 'bignumber.js'
import { max } from '../../../../resources/utils/numbers'

jest.mock('../../../../resources/link', () => ({
  invoke: jest.fn(() => Promise.resolve({ success: true })),
  send: jest.fn()
}))

const maxIntStr = max.toString(10)

describe('changing approval amounts', () => {
  it('allows the user to set the token approval to a custom amount', async () => {
    const onUpdate = jest.fn()
    const requestedAmount = BigNumber('0x011170')
    const approval = {
      id: 'erc20:approve',
      data: {
        spender: {
          address: '0x9bc5baf874d2da8d216ae9f137804184ee5afef4',
          ens: '',
          type: 'external'
        },
        amount: '0x' + requestedAmount.toString(16),
        decimals: 4,
        name: 'TST',
        symbol: 'TST',
        contract: {
          address: '0x1eba19f260421142AD9Bf5ba193f6d4A0825e698',
          ens: '',
          type: 'contract'
        }
      }
    }

    const { user } = render(
      <EditTokenSpend data={approval.data} requestedAmount={requestedAmount} updateRequest={onUpdate} />
    )

    const custom = screen.queryByRole('button', { name: 'Custom' })
    await user.click(custom)
    expect(custom.getAttribute('aria-pressed')).toBe('true')

    const enterAmount = screen.queryByRole('textbox', { name: 'Custom amount' })
    await user.type(enterAmount, '50')

    const updateCustom = screen.getByRole('button', { name: 'Update' })
    await user.dblClick(updateCustom)

    expect(onUpdate).toHaveBeenCalledWith('500000', expect.any(Function))
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })

  it('allows users to input custom amounts which are decimal', async () => {
    const onUpdate = jest.fn()
    const requestedAmount = BigNumber('0x011170')
    const approval = {
      id: 'erc20:approve',
      data: {
        spender: {
          address: '0x9bc5baf874d2da8d216ae9f137804184ee5afef4',
          ens: '',
          type: 'external'
        },
        amount: '0x' + requestedAmount.toString(16),
        decimals: 4,
        name: 'TST',
        symbol: 'TST',
        contract: {
          address: '0x1eba19f260421142AD9Bf5ba193f6d4A0825e698',
          ens: '',
          type: 'contract'
        }
      }
    }

    const { user } = render(
      <EditTokenSpend data={approval.data} requestedAmount={requestedAmount} updateRequest={onUpdate} />
    )

    const custom = screen.queryByRole('button', { name: 'Custom' })
    await user.click(custom)

    const enterAmount = screen.queryByRole('textbox', { name: 'Custom amount' })
    await user.type(enterAmount, '50.1{Enter}')

    expect(onUpdate).toHaveBeenCalledWith('501000', expect.any(Function))
  })

  it('does not allow users to input a custom amount with more decimals than allowed by the contract', async () => {
    const onUpdate = jest.fn()
    const requestedAmount = BigNumber('0x011170')
    const approval = {
      id: 'erc20:approve',
      data: {
        spender: {
          address: '0x9bc5baf874d2da8d216ae9f137804184ee5afef4',
          ens: '',
          type: 'external'
        },
        amount: '0x' + requestedAmount.toString(16),
        decimals: 4,
        name: 'TST',
        symbol: 'TST',
        contract: {
          address: '0x1eba19f260421142AD9Bf5ba193f6d4A0825e698',
          ens: '',
          type: 'contract'
        }
      }
    }

    const { user } = render(
      <EditTokenSpend data={approval.data} requestedAmount={requestedAmount} updateRequest={onUpdate} />
    )

    const custom = screen.queryByRole('button', { name: 'Custom' })
    await user.click(custom)

    const enterAmount = screen.queryByRole('textbox', { name: 'Custom amount' })
    await user.type(enterAmount, '50.00001')

    expect(screen.getByText('Invalid amount')).toBeTruthy()
    expect(screen.queryByText('Update')).toBeNull()
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('does not allows the user to set the token approval to a custom amount for an unknown token', () => {
    const requestedAmount = BigNumber('0x100e6')
    const approval = {
      id: 'erc20:approve',
      data: {
        spender: {
          address: '0x9bc5baf874d2da8d216ae9f137804184ee5afef4',
          ens: '',
          type: 'external'
        },
        amount: '0x' + requestedAmount.toString(16),
        decimals: 6,
        symbol: 'aUSDC',
        contract: {
          address: '0x1eba19f260421142AD9Bf5ba193f6d4A0825e698',
          type: 'contract',
          ens: ''
        }
      }
    }

    render(<EditTokenSpend data={approval.data} requestedAmount={requestedAmount} updateRequest={() => {}} />)

    const custom = screen.queryByRole('button', { name: 'Custom' })
    expect(custom).toBe(null)
  })

  it('allows the user to set the token approval to unlimited', async () => {
    const onUpdate = jest.fn()
    const requestedAmount = BigNumber('0x011170')

    const approval = {
      id: 'erc20:approve',
      data: {
        spender: { address: '0x9bc5baf874d2da8d216ae9f137804184ee5afef4', ens: '', type: 'external' },
        amount: '0x' + requestedAmount.toString(16),
        decimals: 4,
        name: 'TST',
        symbol: 'TST',
        contract: { address: '0x1eba19f260421142AD9Bf5ba193f6d4A0825e698', ens: '', type: 'contract' }
      }
    }

    const { user } = render(
      <EditTokenSpend data={approval.data} requestedAmount={requestedAmount} updateRequest={onUpdate} />
    )

    const custom = screen.queryByRole('button', { name: 'Custom' })
    await user.click(custom)

    const setUnlimited = screen.getByRole('button', { name: 'Unlimited' })
    setUnlimited.focus()
    await user.keyboard('{Enter}')

    expect(onUpdate).toHaveBeenCalledWith(maxIntStr, expect.any(Function))
    expect(setUnlimited.getAttribute('aria-pressed')).toBe('true')
  })

  it('allows the user to revoke a transaction approval explicitly', async () => {
    const onUpdate = jest.fn()
    const requestedAmount = BigNumber('100')
    const approval = {
      data: {
        spender: { address: '0x9bc5baf874d2da8d216ae9f137804184ee5afef4', ens: '', type: 'external' },
        amount: '100',
        decimals: 0,
        name: 'TST',
        symbol: 'TST',
        contract: { address: '0x1eba19f260421142AD9Bf5ba193f6d4A0825e698', ens: '', type: 'contract' }
      }
    }

    const { user } = render(
      <EditTokenSpend
        canRevoke
        data={approval.data}
        requestedAmount={requestedAmount}
        updateRequest={onUpdate}
      />
    )

    const revoke = screen.getByRole('button', { name: 'Revoke' })
    revoke.focus()
    await user.keyboard(' ')

    expect(onUpdate).toHaveBeenCalledWith('0', expect.any(Function))
    expect(revoke.getAttribute('aria-pressed')).toBe('true')
  })

  it('rolls back a rejected preset and suppresses duplicate activation', async () => {
    const onUpdate = jest.fn((_amount, callback) => callback(new Error('update rejected')))
    const requestedAmount = BigNumber('100')
    const approval = {
      data: {
        spender: { address: '0x9bc5baf874d2da8d216ae9f137804184ee5afef4', ens: '', type: 'external' },
        amount: '100',
        decimals: 0,
        name: 'TST',
        symbol: 'TST',
        contract: { address: '0x1eba19f260421142AD9Bf5ba193f6d4A0825e698', ens: '', type: 'contract' }
      }
    }
    const { user } = render(
      <EditTokenSpend data={approval.data} requestedAmount={requestedAmount} updateRequest={onUpdate} />
    )

    const requested = screen.getByRole('button', { name: 'Requested' })
    const unlimited = screen.getByRole('button', { name: 'Unlimited' })
    await user.dblClick(unlimited)

    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenCalledWith(maxIntStr, expect.any(Function))
    expect(requested.getAttribute('aria-pressed')).toBe('true')
    expect(unlimited.getAttribute('aria-pressed')).toBe('false')
  })

  it('supports exact custom amounts for zero-decimal tokens', async () => {
    const onUpdate = jest.fn((_amount, callback) => callback(null))
    const approval = {
      data: {
        spender: { address: '0x9bc5baf874d2da8d216ae9f137804184ee5afef4', ens: '', type: 'external' },
        amount: '1',
        decimals: 0,
        name: 'Whole Token',
        symbol: 'WHOLE',
        contract: { address: '0x1eba19f260421142AD9Bf5ba193f6d4A0825e698', ens: '', type: 'contract' }
      }
    }

    const { user } = render(
      <EditTokenSpend data={approval.data} requestedAmount={BigNumber(1)} updateRequest={onUpdate} />
    )

    await user.click(screen.getByRole('button', { name: 'Custom' }))
    await user.type(screen.getByRole('textbox', { name: 'Custom amount' }), '42')
    await user.click(screen.getByText('Update'))

    expect(onUpdate).toHaveBeenCalledWith('42', expect.any(Function))
  })

  it('supports zero-padded ABI hex amounts', async () => {
    const onUpdate = jest.fn()
    const approval = {
      data: {
        spender: { address: '0x9bc5baf874d2da8d216ae9f137804184ee5afef4', ens: '', type: 'external' },
        amount: '0x01',
        decimals: 0,
        name: 'Whole Token',
        symbol: 'WHOLE',
        contract: { address: '0x1eba19f260421142AD9Bf5ba193f6d4A0825e698', ens: '', type: 'contract' }
      }
    }

    const { user } = render(
      <EditTokenSpend data={approval.data} requestedAmount={BigNumber(1)} updateRequest={onUpdate} />
    )

    expect(screen.getByText('1')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Edit approval amount, current 1' }))
    expect(screen.getByRole('textbox', { name: 'Custom amount' })).toBeTruthy()
  })

  it('shows malformed stored amounts as unknown and keeps editing locked', () => {
    const approval = {
      data: {
        spender: { address: '0x9bc5baf874d2da8d216ae9f137804184ee5afef4', ens: '', type: 'external' },
        amount: '-1',
        decimals: 0,
        name: 'Whole Token',
        symbol: 'WHOLE',
        contract: { address: '0x1eba19f260421142AD9Bf5ba193f6d4A0825e698', ens: '', type: 'contract' }
      }
    }

    render(
      <EditTokenSpend
        canRevoke
        data={approval.data}
        requestedAmount={BigNumber(1)}
        updateRequest={() => {}}
      />
    )

    expect(screen.getByText('unknown')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Custom' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Requested' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Unlimited' })).toBeNull()
    expect(screen.queryByText('Approval Revoked')).toBeNull()
  })

  it('shows exponent input as invalid instead of coercing it', async () => {
    const onUpdate = jest.fn()
    const approval = {
      data: {
        spender: { address: '0x9bc5baf874d2da8d216ae9f137804184ee5afef4', ens: '', type: 'external' },
        amount: '1',
        decimals: 18,
        name: 'TST',
        symbol: 'TST',
        contract: { address: '0x1eba19f260421142AD9Bf5ba193f6d4A0825e698', ens: '', type: 'contract' }
      }
    }

    const { user } = render(
      <EditTokenSpend data={approval.data} requestedAmount={BigNumber(1)} updateRequest={onUpdate} />
    )

    await user.click(screen.getByRole('button', { name: 'Custom' }))
    const input = screen.getByRole('textbox', { name: 'Custom amount' })
    await user.type(input, '1e2{Enter}')

    expect(input.value).toBe('1e2')
    expect(screen.getByText('Invalid amount')).toBeTruthy()
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('allows the user to revert the token approval back to the original request', async () => {
    const onUpdate = jest.fn((_amount, callback) => callback(null))
    const requestedAmountHex = '0x011170'
    const requestedAmount = BigNumber(requestedAmountHex)
    const approval = {
      id: 'erc20:approve',
      data: {
        spender: { address: '0x9bc5baf874d2da8d216ae9f137804184ee5afef4', ens: '', type: 'external' },
        amount: requestedAmountHex,
        decimals: 4,
        name: 'TST',
        symbol: 'TST',
        contract: {
          address: '0x1eba19f260421142AD9Bf5ba193f6d4A0825e698',
          ens: '',
          type: 'contract'
        }
      }
    }

    const { user } = render(
      <EditTokenSpend data={approval.data} requestedAmount={requestedAmount} updateRequest={onUpdate} />
    )

    const setUnlimited = screen.queryByRole('button', { name: 'Unlimited' })
    await user.click(setUnlimited)

    const setRequested = screen.queryByRole('button', { name: 'Requested' })
    expect(setRequested.getAttribute('aria-pressed')).toBe('false')
    await user.click(setRequested)

    expect(onUpdate).toHaveBeenNthCalledWith(1, maxIntStr, expect.any(Function))
    expect(onUpdate).toHaveBeenNthCalledWith(2, '70000', expect.any(Function))
    expect(setRequested.getAttribute('aria-pressed')).toBe('true')
  })

  it('allows a failed custom update to be retried', async () => {
    const onUpdate = jest.fn((_amount, callback) => callback(new Error('update failed')))
    const approval = {
      data: {
        spender: { address: '0x9bc5baf874d2da8d216ae9f137804184ee5afef4', ens: '', type: 'external' },
        amount: '1',
        decimals: 0,
        name: 'Whole Token',
        symbol: 'WHOLE',
        contract: { address: '0x1eba19f260421142AD9Bf5ba193f6d4A0825e698', ens: '', type: 'contract' }
      }
    }
    const { user } = render(
      <EditTokenSpend data={approval.data} requestedAmount={BigNumber(1)} updateRequest={onUpdate} />
    )

    await user.click(screen.getByRole('button', { name: 'Custom' }))
    await user.type(screen.getByRole('textbox', { name: 'Custom amount' }), '42')
    const update = screen.getByRole('button', { name: 'Update' })
    await user.click(update)
    await user.click(update)

    expect(onUpdate).toHaveBeenCalledTimes(2)
    expect(onUpdate).toHaveBeenNthCalledWith(1, '42', expect.any(Function))
    expect(onUpdate).toHaveBeenNthCalledWith(2, '42', expect.any(Function))
  })

  it('keeps amount editing locked while a custom update is pending', async () => {
    const onUpdate = jest.fn()
    const approval = {
      data: {
        spender: { address: '0x9bc5baf874d2da8d216ae9f137804184ee5afef4', ens: '', type: 'external' },
        amount: '1',
        decimals: 0,
        name: 'Whole Token',
        symbol: 'WHOLE',
        contract: { address: '0x1eba19f260421142AD9Bf5ba193f6d4A0825e698', ens: '', type: 'contract' }
      }
    }
    const { user } = render(
      <EditTokenSpend data={approval.data} requestedAmount={BigNumber(1)} updateRequest={onUpdate} />
    )

    await user.click(screen.getByRole('button', { name: 'Custom' }))
    const input = screen.getByRole('textbox', { name: 'Custom amount' })
    await user.type(input, '42')
    await user.click(screen.getByRole('button', { name: 'Update' }))

    expect(input.disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Requested' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Unlimited' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Custom' }).disabled).toBe(true)
    await user.type(input, '7')
    expect(input.value).toBe('42')
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })

  it('unlocks editing after the request update completes', async () => {
    let completeUpdate
    const onUpdate = jest.fn((_amount, callback) => {
      completeUpdate = callback
    })
    const approval = {
      data: {
        spender: { address: '0x9bc5baf874d2da8d216ae9f137804184ee5afef4', ens: '', type: 'external' },
        amount: '1',
        decimals: 0,
        name: 'Whole Token',
        symbol: 'WHOLE',
        contract: { address: '0x1eba19f260421142AD9Bf5ba193f6d4A0825e698', ens: '', type: 'contract' }
      }
    }
    const { rerender, user } = render(
      <EditTokenSpend data={approval.data} requestedAmount={BigNumber(1)} updateRequest={onUpdate} />
    )

    await user.click(screen.getByRole('button', { name: 'Custom' }))
    const input = screen.getByRole('textbox', { name: 'Custom amount' })
    await user.type(input, '42')
    await user.click(screen.getByRole('button', { name: 'Update' }))
    expect(input.disabled).toBe(true)

    await act(async () => completeUpdate(null))
    expect(screen.getByRole('textbox', { name: 'Custom amount' }).disabled).toBe(false)

    rerender(
      <EditTokenSpend
        data={{ ...approval.data, amount: '42' }}
        requestedAmount={BigNumber(1)}
        updateRequest={onUpdate}
      />
    )

    expect(screen.getByRole('textbox', { name: 'Custom amount' }).disabled).toBe(false)
    expect(screen.getByRole('button', { name: 'Requested' }).disabled).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Unlimited' }))
    await act(async () => completeUpdate(null))
    rerender(
      <EditTokenSpend
        data={{ ...approval.data, amount: maxIntStr }}
        requestedAmount={BigNumber(1)}
        updateRequest={onUpdate}
      />
    )

    expect(screen.getByRole('button', { name: 'Requested' }).disabled).toBe(false)
    expect(screen.getByRole('button', { name: 'Unlimited' }).disabled).toBe(false)
  })

  it('suppresses the second activation of a completed double click', async () => {
    const onUpdate = jest.fn((_amount, callback) => callback(null))
    const approval = {
      data: {
        spender: { address: '0x9bc5baf874d2da8d216ae9f137804184ee5afef4', ens: '', type: 'external' },
        amount: '1',
        decimals: 0,
        name: 'Whole Token',
        symbol: 'WHOLE',
        contract: { address: '0x1eba19f260421142AD9Bf5ba193f6d4A0825e698', ens: '', type: 'contract' }
      }
    }
    const { user } = render(
      <EditTokenSpend data={approval.data} requestedAmount={BigNumber(1)} updateRequest={onUpdate} />
    )

    await user.click(screen.getByRole('button', { name: 'Custom' }))
    await user.type(screen.getByRole('textbox', { name: 'Custom amount' }), '42')
    await user.dblClick(screen.getByRole('button', { name: 'Update' }))

    expect(onUpdate).toHaveBeenCalledTimes(1)
  })

  it('copies the exact spender and token contract addresses', async () => {
    const approval = {
      data: {
        spender: { address: '0x9bc5baf874d2da8d216ae9f137804184ee5afef4', ens: '', type: 'external' },
        amount: '1',
        decimals: 0,
        name: 'Whole Token',
        symbol: 'WHOLE',
        contract: { address: '0x1eba19f260421142AD9Bf5ba193f6d4A0825e698', ens: '', type: 'contract' }
      }
    }
    const { user } = render(
      <EditTokenSpend data={approval.data} requestedAmount={BigNumber(1)} updateRequest={() => {}} />
    )

    await user.click(screen.getByRole('button', { name: 'Copy spender address' }))
    await user.click(screen.getByRole('button', { name: 'Copy token contract address' }))

    expect(link.invoke).toHaveBeenNthCalledWith(1, 'tray:writeClipboard', {
      secret: false,
      value: approval.data.spender.address
    })
    expect(link.invoke).toHaveBeenNthCalledWith(2, 'tray:writeClipboard', {
      secret: false,
      value: approval.data.contract.address
    })
  })

  it('allows the user to revert the token approval back to the original amount when no decimal data is present', async () => {
    const onUpdate = jest.fn((_amount, callback) => callback(null))
    const requestedAmountHex = '0x011170'
    const requestedAmount = BigNumber(requestedAmountHex)
    const approval = {
      id: 'erc20:approve',
      data: {
        spender: {
          address: '0x9bc5baf874d2da8d216ae9f137804184ee5afef4',
          ens: '',
          type: 'external'
        },
        amount: requestedAmountHex,
        name: 'TST',
        symbol: 'TST',
        contract: {
          address: '0x1eba19f260421142AD9Bf5ba193f6d4A0825e698',
          ens: '',
          type: 'contract'
        }
      }
    }

    const { user } = render(
      <EditTokenSpend data={approval.data} requestedAmount={requestedAmount} updateRequest={onUpdate} />
    )

    const setUnlimited = screen.queryByRole('button', { name: 'Unlimited' })
    await user.click(setUnlimited)

    const setRequested = screen.queryByRole('button', { name: 'Requested' })
    await user.click(setRequested)

    expect(onUpdate).toHaveBeenNthCalledWith(1, maxIntStr, expect.any(Function))
    expect(onUpdate).toHaveBeenNthCalledWith(2, BigNumber('0x011170').toString(10), expect.any(Function))
  })

  const requiredApprovalData = ['decimals', 'symbol', 'name']

  requiredApprovalData.forEach((field) => {
    it(`does not allow the user to edit the amount if ${field} is not present in approval data`, async () => {
      const requestedAmountHex = '0x' + (100e6).toString(16)
      const approval = {
        id: 'erc20:approve',
        data: {
          spender: {
            address: '0x9bc5baf874d2da8d216ae9f137804184ee5afef4',
            ens: '',
            type: 'external'
          },
          amount: requestedAmountHex,
          decimals: 6,
          name: 'TST',
          symbol: 'TST',
          contract: {
            address: '0x1eba19f260421142AD9Bf5ba193f6d4A0825e698',
            ens: '',
            type: 'contract'
          }
        }
      }

      delete approval.data[field]

      const { user } = render(
        <EditTokenSpend
          data={approval.data}
          requestedAmount={BigNumber(requestedAmountHex)}
          updateRequest={() => {}}
        />
      )

      const custom = screen.queryByRole('button', { name: 'Custom' })
      expect(custom).toBeNull()

      const displayedContent = approval.data.decimals ? '100' : '100000000'
      const requestedAmount = screen.getByText(displayedContent)

      // ensure click on requested amount textbox doesn't allow user to enter a custom amount
      await user.click(requestedAmount)
      expect(screen.queryByRole('textbox', { name: 'Custom amount' })).toBeNull()
    })
  })
})
