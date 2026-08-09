import { AddHotAccount } from '../Components'
import { addHexPrefix, isHexString, isValidPrivate } from '@ethereumjs/util'

const validatePrivateKey = (privateKeyStr) => {
  const prefixed = addHexPrefix(privateKeyStr)
  if (!isHexString(prefixed) || !isValidPrivate(prefixed.slice(2))) {
    return 'Enter a valid private key'
  }
}

export default function AddRing({ accountData }) {
  return (
    <AddHotAccount
      {...{
        title: 'Private key',
        summary: 'Import an account from a private key.',
        svgName: 'key',
        intro: 'Add private key account',
        accountData,
        createSignerMethod: 'createFromPrivateKey',
        newAccountType: 'keyring',
        validateSecret: validatePrivateKey
      }}
    />
  )
}
