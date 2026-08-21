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

const rollbackGeneratedWallet = (
  { accounts, log, signers },
  { accountExisted, address, previousId, signerId }
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

  if (previousId && accounts.get(previousId)) {
    try {
      accounts.setSigner(previousId, (error) => {
        if (error) log.warn('Could not restore the previously selected account', error)
      })
    } catch (error) {
      complete = false
      log.warn('Could not restore the previously selected account', error)
    }
  }

  return complete
}

const completeGeneratedWalletAccount = ({ accounts, log, provider, signers }, id, proof, cb) => {
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
        const rolledBack = rollbackGeneratedWallet(
          { accounts, log, signers },
          { accountExisted, address: normalizedAddress, previousId, signerId }
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
