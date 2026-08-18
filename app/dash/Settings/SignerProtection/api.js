import link from '../../../../resources/link'

const protectionResult = (result) => {
  if (!result || typeof result.success !== 'boolean') {
    throw new Error('Software signer protection response was unavailable')
  }
  return result
}

export const getSignerProtectionStatus = async () =>
  protectionResult(await link.invoke('signers:protectionStatus'))

export const enableSignerProtection = async () =>
  protectionResult(await link.invoke('signers:enableProtection', 'ENABLE_OS_SIGNER_PROTECTION'))

export const disableSignerProtection = async () =>
  protectionResult(await link.invoke('signers:disableProtection', 'DISABLE_OS_SIGNER_PROTECTION'))
