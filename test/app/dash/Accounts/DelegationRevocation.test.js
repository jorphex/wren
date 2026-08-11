import React from 'react'

import { act, render, screen } from '../../../componentSetup'
import {
  connectedNetworks,
  DelegationRevocation,
  delegationRevocationCopy,
  isSoftwareAccount
} from '../../../../app/dash/Accounts/DelegationRevocation'
import link from '../../../../resources/link'

jest.mock('../../../../resources/link', () => ({ rpc: jest.fn(), send: jest.fn() }))

const account = '0x0000000000000000000000000000000000000001'
const delegate = '0x0000000000000000000000000000000000000002'
const signer = { id: 'local-signer', type: 'ring' }
const accounts = {
  [account]: { id: account, address: account, name: 'Workshop', signer: signer.id, lastSignerType: 'ring' }
}
const networks = {
  1: {
    id: 1,
    name: 'Ethereum',
    on: true,
    connection: { endpoints: [{ connected: true }] }
  },
  10: {
    id: 10,
    name: 'Offline',
    on: true,
    connection: { endpoints: [{ connected: false }] }
  }
}

beforeEach(() => {
  link.rpc.mockReset()
  link.send.mockReset()
})

it('recognizes only local software accounts and connected enabled networks', () => {
  expect(isSoftwareAccount(accounts[account], { [signer.id]: signer })).toBe(true)
  expect(isSoftwareAccount({ ...accounts[account], lastSignerType: 'ledger', signer: undefined })).toBe(false)
  expect(connectedNetworks(networks)).toEqual([{ id: 1, name: 'Ethereum' }])
})

it('checks the selected software account and queues only an eligible revocation', async () => {
  link.rpc.mockImplementation((method, ...args) => {
    const callback = args.at(-1)
    if (method === 'getEip7702RevocationEligibility') {
      callback(null, {
        status: 'eligible',
        account,
        chainId: 1,
        source: 'eth_getCode',
        delegate,
        codeHash: `0x${'11'.repeat(32)}`
      })
    } else if (method === 'requestEip7702Revocation') {
      callback(null, { type: 'eip7702Revoke', account, handlerId: 'revoke-1' })
    }
  })

  const { user } = render(
    <DelegationRevocation
      accounts={accounts}
      currentAccount={account}
      networks={networks}
      signers={{ [signer.id]: signer }}
    />
  )

  expect(await screen.findByText('Configured RPC · eth_getCode')).toBeTruthy()
  expect(screen.getByText(delegate)).toBeTruthy()
  expect(link.rpc).toHaveBeenCalledWith('getEip7702RevocationEligibility', account, 1, expect.any(Function))

  await user.click(screen.getByRole('button', { name: 'Revoke delegation' }))
  expect(link.rpc).toHaveBeenCalledWith('requestEip7702Revocation', account, 1, expect.any(Function))
  expect(link.send).toHaveBeenCalledWith('tray:action', 'closeDash')
  expect(link.send).toHaveBeenCalledWith('nav:forward', 'panel', {
    view: 'requestView',
    data: { step: 'confirm', accountId: account, requestId: 'revoke-1' }
  })
})

it('makes account selection explicit before checking a different software account', async () => {
  link.rpc.mockImplementation((method, ...args) => {
    const callback = args.at(-1)
    if (method === 'setSigner') callback(null)
    if (method === 'getEip7702RevocationEligibility') {
      callback(null, { status: 'not-delegated', account, chainId: 1 })
    }
  })

  const { user } = render(
    <DelegationRevocation
      accounts={accounts}
      currentAccount='0x0000000000000000000000000000000000000003'
      networks={networks}
      signers={{ [signer.id]: signer }}
    />
  )

  expect(link.rpc).not.toHaveBeenCalled()
  await user.selectOptions(screen.getByLabelText('Selected software account'), account)

  expect(link.rpc).toHaveBeenCalledWith('setSigner', account, expect.any(Function))
  expect(await screen.findByText(delegationRevocationCopy.none)).toBeTruthy()
})

it('does not offer unsupported accounts as eligible', () => {
  render(
    <DelegationRevocation
      accounts={{ [account]: { ...accounts[account], signer: undefined, lastSignerType: 'ledger' } }}
      currentAccount={account}
      networks={networks}
      signers={{}}
    />
  )

  expect(screen.getByText(delegationRevocationCopy.hardware)).toBeTruthy()
  expect(document.body.textContent).not.toContain('Request not sent')
  expect(screen.queryByRole('button', { name: 'Revoke delegation' })).toBeNull()
  expect(link.rpc).not.toHaveBeenCalled()
})

it('rechecks eligibility when the selected network reconnects', async () => {
  link.rpc.mockImplementation((method, selectedAccount, chainId, callback) => {
    if (method === 'getEip7702RevocationEligibility') {
      callback(null, {
        status: 'eligible',
        account: selectedAccount,
        chainId,
        source: 'eth_getCode',
        delegate,
        codeHash: `0x${'11'.repeat(32)}`
      })
    }
  })
  const props = {
    accounts,
    currentAccount: account,
    signers: { [signer.id]: signer }
  }
  const { rerender } = render(<DelegationRevocation {...props} networks={networks} />)

  expect(await screen.findByText(delegate)).toBeTruthy()
  const disconnected = {
    ...networks,
    1: { ...networks[1], connection: { endpoints: [{ connected: false }] } }
  }
  rerender(<DelegationRevocation {...props} networks={disconnected} />)
  expect(await screen.findByText(delegationRevocationCopy.unavailable)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Revoke delegation' })).toBeNull()

  const reconnected = {
    ...networks,
    1: { ...networks[1], connection: { endpoints: [{ connected: true }] } }
  }
  rerender(<DelegationRevocation {...props} networks={reconnected} />)
  expect(await screen.findByText(delegate)).toBeTruthy()
  expect(link.rpc.mock.calls.filter(([method]) => method === 'getEip7702RevocationEligibility')).toHaveLength(
    2
  )
})

it('ignores stale eligibility results when the network changes', async () => {
  const callbacks = new Map()
  link.rpc.mockImplementation((method, _account, chainId, callback) => {
    if (method === 'getEip7702RevocationEligibility') callbacks.set(chainId, callback)
  })
  const withPolygon = {
    ...networks,
    137: {
      id: 137,
      name: 'Polygon',
      on: true,
      connection: { endpoints: [{ connected: true }] }
    }
  }
  const ref = React.createRef()
  render(
    <DelegationRevocation
      ref={ref}
      accounts={accounts}
      currentAccount={account}
      networks={withPolygon}
      signers={{ [signer.id]: signer }}
    />
  )

  act(() => ref.current.checkEligibility(account, 137))
  act(() => {
    callbacks.get(137)(null, {
      status: 'eligible',
      account,
      chainId: 137,
      delegate,
      codeHash: `0x${'22'.repeat(32)}`
    })
  })
  expect(await screen.findByText(delegate)).toBeTruthy()

  act(() => callbacks.get(1)(null, { status: 'not-delegated', account, chainId: 1 }))
  expect(screen.getByText(delegate)).toBeTruthy()
  expect(screen.queryByText(delegationRevocationCopy.none)).toBeNull()
})

it('recovers with bounded copy when request admission fails', async () => {
  link.rpc.mockImplementation((method, ...args) => {
    const callback = args.at(-1)
    if (method === 'getEip7702RevocationEligibility') {
      callback(null, {
        status: 'eligible',
        account,
        chainId: 1,
        delegate,
        codeHash: `0x${'11'.repeat(32)}`
      })
    } else if (method === 'requestEip7702Revocation') {
      callback(new Error('admission failed'))
    }
  })
  const { user } = render(
    <DelegationRevocation
      accounts={accounts}
      currentAccount={account}
      networks={networks}
      signers={{ [signer.id]: signer }}
    />
  )

  await user.click(await screen.findByRole('button', { name: 'Revoke delegation' }))

  expect(await screen.findByText(delegationRevocationCopy.admissionFailed)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Revoke delegation' })).toBeNull()
  expect(link.send).not.toHaveBeenCalled()
})
