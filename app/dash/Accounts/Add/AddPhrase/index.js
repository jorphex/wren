import { AddHotAccount } from '../Components'
import { validateMnemonic as isValidMnemonic } from 'bip39'

const validateMnemonic = (mnemonic) => {
  if (!isValidMnemonic(mnemonic)) return 'Enter a valid recovery phrase'
  if (mnemonic.split(' ').length < 12) return 'Recovery phrase is too short'
}

export default function AddPhrase({ accountSetupStep, error }) {
  return (
    <AddHotAccount
      {...{
        title: 'Recovery phrase',
        summary: 'Import an account from a recovery phrase.',
        svgName: 'seedling',
        intro: 'Add seed phrase account',
        accountSetupStep,
        error,
        createSignerMethod: 'createFromPhrase',
        newAccountType: 'seed',
        validateSecret: validateMnemonic
      }}
    />
  )
}
