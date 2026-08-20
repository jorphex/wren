import link from '../../../resources/link'

export const PUBLIC_SOURCE_CONFIRMATION = 'PUBLISH_CONTRACT_SOURCE'
export const ETHERSCAN_CONFIRMATION = 'PUBLISH_TO_ETHERSCAN'

export const inspectVerificationArtifact = () => link.invoke('contractVerification:inspectArtifact')

export const selectVerificationArtifact = (artifactToken, contractIdentifier) =>
  link.invoke('contractVerification:selectArtifact', artifactToken, contractIdentifier)

export const getVerification = (verificationId) => link.invoke('contractVerification:get', verificationId)

export const listVerifications = () => link.invoke('contractVerification:list')

export const openVerificationResult = (jobId, destination) =>
  link.invoke('contractVerification:openResult', { jobId, destination })

export const prepareVerification = (input) => link.invoke('contractVerification:prepare', input)

export const publishVerification = (acknowledgementToken) =>
  link.invoke('contractVerification:publish', {
    acknowledgementToken,
    confirmation: PUBLIC_SOURCE_CONFIRMATION
  })

export const refreshVerification = (verificationId) =>
  link.invoke('contractVerification:refresh', verificationId)

export const reselectVerificationSource = (input) => link.invoke('contractVerification:reselect', input)

export const getExplorerCredentialStatus = () => link.invoke('contractVerification:credentialStatus')

export const publishVerificationToEtherscan = (
  verificationId,
  constructorArguments,
  noConstructorArguments
) =>
  link.invoke('contractVerification:publishEtherscan', {
    jobId: verificationId,
    confirmation: ETHERSCAN_CONFIRMATION,
    ...(noConstructorArguments ? { noConstructorArguments: true } : { constructorArguments })
  })
