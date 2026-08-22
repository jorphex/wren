const { accountNameForSigner, completeGeneratedWalletAccount } = require('../../../main/rpc/generatedWallet')

const ADDRESS = '0x0000000000000000000000000000000000000001'
const PREVIOUS_ADDRESS = '0x0000000000000000000000000000000000000002'
const flush = async () => {
  for (let index = 0; index < 24; index += 1) await Promise.resolve()
}

const setup = ({ previousAccount } = {}) => {
  const admittedAccounts = new Map()
  if (previousAccount) admittedAccounts.set(previousAccount.id, previousAccount)
  const commitState = jest.fn()
  const accounts = {
    add: jest.fn((address, name, options, cb) => {
      const account = { id: address.toLowerCase() }
      admittedAccounts.set(account.id, account)
      return cb(null, account)
    }),
    current: jest.fn(() => previousAccount),
    get: jest.fn((id) => admittedAccounts.get(id)),
    getSelectedAddresses: jest.fn().mockReturnValueOnce([]).mockReturnValue([ADDRESS]),
    remove: jest.fn((id) => admittedAccounts.delete(id)),
    setSigner: jest.fn((id, cb) => cb(null, { id }))
  }
  const log = { warn: jest.fn() }
  const provider = { accountsChanged: jest.fn() }
  const signers = {
    completeGeneratedWallet: jest.fn((id, proof, cb) =>
      cb(null, { address: ADDRESS, id: 'generated-signer', type: 'seed' })
    ),
    remove: jest.fn()
  }
  return { accounts, commitState, log, provider, signers }
}

test('creates and selects the generated signer account before reporting success', async () => {
  const dependencies = setup()
  const cb = jest.fn()

  completeGeneratedWalletAccount(dependencies, 'session', { words: ['a', 'b', 'c'] }, cb)
  await flush()

  expect(dependencies.accounts.add).toHaveBeenCalledWith(
    ADDRESS,
    'Recovery Phrase Account',
    { type: 'seed' },
    expect.any(Function)
  )
  expect(dependencies.accounts.setSigner).toHaveBeenCalledWith(ADDRESS.toLowerCase(), expect.any(Function))
  expect(dependencies.provider.accountsChanged).toHaveBeenCalledWith([ADDRESS])
  expect(dependencies.commitState).toHaveBeenCalledTimes(1)
  expect(dependencies.commitState.mock.invocationCallOrder[0]).toBeLessThan(
    dependencies.provider.accountsChanged.mock.invocationCallOrder[0]
  )
  expect(dependencies.commitState.mock.invocationCallOrder[0]).toBeLessThan(cb.mock.invocationCallOrder[0])
  expect(cb).toHaveBeenCalledWith(null, {
    accountId: ADDRESS.toLowerCase(),
    address: ADDRESS,
    id: 'generated-signer',
    selected: true,
    type: 'seed'
  })
})

test('does not let a destroyed renderer callback unwind account activation', async () => {
  const dependencies = setup()
  const cb = jest.fn(() => {
    throw new Error('renderer closed')
  })

  expect(() => completeGeneratedWalletAccount(dependencies, 'session', {}, cb)).not.toThrow()
  await flush()
  expect(dependencies.log.warn).toHaveBeenCalledWith(
    'Could not deliver generated wallet result',
    expect.any(Error)
  )
  expect(dependencies.accounts.setSigner).toHaveBeenCalledTimes(1)
})

test('reports account admission failure without attempting selection', async () => {
  const dependencies = setup()
  dependencies.accounts.add.mockImplementationOnce((address, name, options, cb) =>
    cb(new Error('account admission failed'))
  )
  const cb = jest.fn()

  completeGeneratedWalletAccount(dependencies, 'session', {}, cb)
  await flush()

  expect(cb).toHaveBeenCalledWith(expect.objectContaining({ message: 'account admission failed' }))
  expect(dependencies.accounts.setSigner).not.toHaveBeenCalled()
  expect(dependencies.signers.remove).toHaveBeenCalledWith('generated-signer')
  expect(dependencies.commitState).toHaveBeenCalledTimes(1)
})

test('waits for account persistence before selecting and reporting success', async () => {
  const dependencies = setup()
  let rejectAdmission
  dependencies.accounts.add.mockImplementationOnce((address, name, options, cb) => {
    cb(null, { id: address.toLowerCase() })
    return new Promise((resolve, reject) => {
      rejectAdmission = reject
    })
  })
  const cb = jest.fn()

  completeGeneratedWalletAccount(dependencies, 'session', {}, cb)
  expect(dependencies.accounts.setSigner).not.toHaveBeenCalled()

  rejectAdmission(new Error('account persistence failed'))
  await flush()

  expect(dependencies.accounts.setSigner).not.toHaveBeenCalled()
  expect(dependencies.signers.remove).toHaveBeenCalledWith('generated-signer')
  expect(dependencies.commitState).toHaveBeenCalledTimes(1)
  expect(cb).toHaveBeenCalledWith(expect.objectContaining({ message: 'account persistence failed' }))
})

test('does not report success when selection throws after invoking its callback', async () => {
  const dependencies = setup()
  dependencies.accounts.setSigner.mockImplementationOnce((id, cb) => {
    cb(null, { id })
    throw new Error('selection persistence failed')
  })
  const cb = jest.fn()

  completeGeneratedWalletAccount(dependencies, 'session', {}, cb)
  await flush()

  expect(cb).toHaveBeenCalledTimes(1)
  expect(cb).toHaveBeenCalledWith(expect.objectContaining({ message: 'selection persistence failed' }))
  expect(dependencies.accounts.remove).toHaveBeenCalledWith(ADDRESS.toLowerCase())
  expect(dependencies.signers.remove).toHaveBeenCalledWith('generated-signer')
  expect(dependencies.commitState).toHaveBeenCalledTimes(1)
})

test('rolls back and durably commits the rollback when the success snapshot cannot be persisted', async () => {
  const previousAccount = { id: PREVIOUS_ADDRESS }
  const dependencies = setup({ previousAccount })
  dependencies.commitState.mockRejectedValueOnce(new Error('profile commit failed')).mockResolvedValueOnce()
  const cb = jest.fn()

  completeGeneratedWalletAccount(dependencies, 'session', {}, cb)
  await flush()

  expect(dependencies.accounts.remove).toHaveBeenCalledWith(ADDRESS.toLowerCase())
  expect(dependencies.signers.remove).toHaveBeenCalledWith('generated-signer')
  expect(dependencies.accounts.setSigner).toHaveBeenLastCalledWith(PREVIOUS_ADDRESS, expect.any(Function))
  expect(dependencies.commitState).toHaveBeenCalledTimes(2)
  expect(dependencies.provider.accountsChanged).not.toHaveBeenCalled()
  expect(cb).toHaveBeenCalledWith(expect.objectContaining({ message: 'profile commit failed' }))
})

test('reports partial rollback when the rollback snapshot cannot be persisted', async () => {
  const dependencies = setup()
  dependencies.commitState.mockRejectedValueOnce(new Error('profile commit failed'))
  dependencies.commitState.mockRejectedValueOnce(new Error('rollback commit failed'))
  const cb = jest.fn()

  completeGeneratedWalletAccount(dependencies, 'session', {}, cb)
  await flush()

  expect(dependencies.accounts.remove).toHaveBeenCalledWith(ADDRESS.toLowerCase())
  expect(dependencies.signers.remove).toHaveBeenCalledWith('generated-signer')
  expect(cb).toHaveBeenCalledWith(
    expect.objectContaining({
      message: 'Wallet creation could not be rolled back completely. Check Accounts before trying again.'
    })
  )
  expect(dependencies.log.warn).toHaveBeenCalledWith(
    'Could not persist generated wallet rollback',
    expect.objectContaining({ message: 'rollback commit failed' })
  )
})

test('reports partial rollback honestly when a generated signer cannot be removed', async () => {
  const dependencies = setup()
  dependencies.accounts.add.mockImplementationOnce((address, name, options, cb) =>
    cb(new Error('account admission failed'))
  )
  dependencies.signers.remove.mockImplementationOnce(() => {
    throw new Error('remove failed')
  })
  const cb = jest.fn()

  completeGeneratedWalletAccount(dependencies, 'session', {}, cb)
  await flush()

  expect(cb).toHaveBeenCalledWith(
    expect.objectContaining({
      message: 'Wallet creation could not be rolled back completely. Check Accounts before trying again.'
    })
  )
  expect(dependencies.log.warn).toHaveBeenCalledWith(
    'Could not roll back generated signer',
    expect.any(Error)
  )
})

test('uses signer-specific default account names', () => {
  expect(accountNameForSigner('seed')).toBe('Recovery Phrase Account')
  expect(accountNameForSigner('ring')).toBe('Private Key Account')
})
