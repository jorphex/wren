import {
  ETHERSCAN_CONFIRMATION,
  getExplorerCredentialStatus,
  getVerification,
  inspectVerificationArtifact,
  listVerifications,
  openVerificationResult,
  prepareVerification,
  PUBLIC_SOURCE_CONFIRMATION,
  publishVerification,
  publishVerificationToEtherscan,
  refreshVerification,
  reselectVerificationSource,
  selectVerificationArtifact
} from '../../../../app/dash/ContractVerification/api'
import link from '../../../../resources/link'

jest.mock('../../../../resources/link', () => ({ invoke: jest.fn() }))

beforeEach(() => {
  link.invoke.mockReset().mockResolvedValue({ success: true })
})

it('uses bounded contract-verification channels and exact envelopes', async () => {
  const prepare = {
    artifactToken: 'artifact-1',
    chainId: 1,
    address: '0x1111111111111111111111111111111111111111',
    compilerVersion: '0.8.28',
    contractIdentifier: 'src/A.sol:A'
  }
  const reselect = { jobId: 'verification-1', artifactToken: 'artifact-2' }

  await inspectVerificationArtifact()
  await selectVerificationArtifact('artifact-1', 'src/A.sol:A')
  await getVerification('verification-1')
  await listVerifications()
  await openVerificationResult('verification-1', 'blockscout-forwarded')
  await prepareVerification(prepare)
  await publishVerification('acknowledgement-1')
  await refreshVerification('verification-1')
  await reselectVerificationSource(reselect)
  await getExplorerCredentialStatus()
  await publishVerificationToEtherscan('verification-1', '', true)

  expect(link.invoke.mock.calls).toEqual([
    ['contractVerification:inspectArtifact'],
    ['contractVerification:selectArtifact', 'artifact-1', 'src/A.sol:A'],
    ['contractVerification:get', 'verification-1'],
    ['contractVerification:list'],
    ['contractVerification:openResult', { jobId: 'verification-1', destination: 'blockscout-forwarded' }],
    ['contractVerification:prepare', prepare],
    [
      'contractVerification:publish',
      {
        acknowledgementToken: 'acknowledgement-1',
        confirmation: PUBLIC_SOURCE_CONFIRMATION
      }
    ],
    ['contractVerification:refresh', 'verification-1'],
    ['contractVerification:reselect', reselect],
    ['contractVerification:credentialStatus'],
    [
      'contractVerification:publishEtherscan',
      {
        jobId: 'verification-1',
        confirmation: ETHERSCAN_CONFIRMATION,
        noConstructorArguments: true
      }
    ]
  ])
})
