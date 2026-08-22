const accountNameForSigner = (type) => (type === 'seed' ? 'Recovery Phrase Account' : 'Private Key Account')

const report = (log, cb, ...args) => {
  try {
    cb(...args)
  } catch (error) {
    log.warn('Could not deliver generated wallet result', error)
  }
}

const callbackAfterReturn = (invoke) =>
  new Promise((resolve, reject) => {
    let callbackArgs
    let callbackCalled = false
    let returned = false

    const finish = () => {
      if (!callbackCalled || !returned) return
      const [error, value] = callbackArgs
      if (error) reject(error)
      else resolve(value)
    }

    let result
    try {
      result = invoke((...args) => {
        if (callbackCalled) return
        callbackCalled = true
        callbackArgs = args
        finish()
      })
    } catch (error) {
      reject(error)
      return
    }

    Promise.resolve(result).then(() => {
      returned = true
      finish()
    }, reject)
  })

const commitCurrentProfile = () => {
  const store = require('../store').default
  const { commitMainState } = require('../store/persist')
  commitMainState(store('main'))
}

const rollbackGeneratedWallet = async (
  { accounts, log, signers },
  { accountExisted, address, commitState, previousId, signerId }
) => {
  let complete = true

  if (!accountExisted && accounts.get(address)) {
    try {
      accounts.remove(address)
    } catch (error) {
      complete = false
      log.warn('Could not roll back generated wallet account', error)
    }
  }

  try {
    signers.remove(signerId)
  } catch (error) {
    complete = false
    log.warn('Could not roll back generated signer', error)
  }

  if (previousId) {
    try {
      if (!accounts.get(previousId)) throw new Error('Previously selected account is unavailable')
      await callbackAfterReturn((selectionCb) => accounts.setSigner(previousId, selectionCb))
    } catch (error) {
      complete = false
      log.warn('Could not restore the previously selected account', error)
    }
  }

  try {
    await Promise.resolve().then(commitState)
  } catch (error) {
    complete = false
    log.warn('Could not persist generated wallet rollback', error)
  }

  return complete
}

const completeGeneratedWalletAccount = (
  { accounts, commitState = commitCurrentProfile, log, provider, signers },
  id,
  proof,
  cb
) => {
  signers.completeGeneratedWallet(id, proof, (completionError, signer) => {
    if (completionError) return report(log, cb, completionError)

    const { address, id: signerId, type } = signer || {}
    if (!address || !signerId || !['ring', 'seed'].includes(type)) {
      return report(log, cb, new Error('Generated signer admission returned invalid account data'))
    }

    const normalizedAddress = address.toLowerCase()
    const accountExisted = Boolean(accounts.get(normalizedAddress))
    const previousId = accounts.current()?.id
    const previousAddresses = accounts.getSelectedAddresses()

    const finish = async () => {
      try {
        const account = await callbackAfterReturn((accountCb) =>
          accounts.add(address, accountNameForSigner(type), { type }, accountCb)
        )
        if (!account?.id) throw new Error('Generated account admission returned invalid data')
        await callbackAfterReturn((selectionCb) => accounts.setSigner(account.id, selectionCb))
        await Promise.resolve().then(commitState)

        const currentAddresses = accounts.getSelectedAddresses()
        if (JSON.stringify(previousAddresses) !== JSON.stringify(currentAddresses)) {
          try {
            provider.accountsChanged(currentAddresses)
          } catch (error) {
            log.warn('Could not notify providers about the generated account', error)
          }
        }
        report(log, cb, null, {
          accountId: account.id,
          address,
          id: signerId,
          selected: true,
          type
        })
      } catch (error) {
        const rolledBack = await rollbackGeneratedWallet(
          { accounts, log, signers },
          { accountExisted, address: normalizedAddress, commitState, previousId, signerId }
        )
        report(
          log,
          cb,
          rolledBack
            ? error
            : new Error(
                'Wallet creation could not be rolled back completely. Check Accounts before trying again.'
              )
        )
      }
    }

    void finish()
  })
}

module.exports = {
  accountNameForSigner,
  callbackAfterReturn,
  completeGeneratedWalletAccount,
  rollbackGeneratedWallet
}
