import { hasRendererCapability } from '../../../resources/bridge/roles'

const verificationChannels = [
  'contractVerification:credentialStatus',
  'contractVerification:get',
  'contractVerification:inspectArtifact',
  'contractVerification:list',
  'contractVerification:openResult',
  'contractVerification:prepare',
  'contractVerification:publish',
  'contractVerification:publishEtherscan',
  'contractVerification:refresh',
  'contractVerification:removeCredential',
  'contractVerification:reselect',
  'contractVerification:saveCredential',
  'contractVerification:selectArtifact'
]

test('limits every contract verification invoke to the dashboard role', () => {
  for (const channel of verificationChannels) {
    expect(hasRendererCapability('dash', 'invoke', [channel])).toBe(true)
    expect(hasRendererCapability('tray', 'invoke', [channel])).toBe(false)
    expect(hasRendererCapability('dapp', 'invoke', [channel])).toBe(false)
    expect(hasRendererCapability('onboard', 'invoke', [channel])).toBe(false)
  }
})

test('allows only trusted application windows to continue from a deployment review', () => {
  const channel = 'tray:continueContractVerification'
  expect(hasRendererCapability('dash', 'invoke', [channel])).toBe(true)
  expect(hasRendererCapability('tray', 'invoke', [channel])).toBe(true)
  expect(hasRendererCapability('dapp', 'invoke', [channel])).toBe(false)
  expect(hasRendererCapability('onboard', 'invoke', [channel])).toBe(false)
})

test('does not treat an unregistered verification-like prefix as a dashboard-only exception', () => {
  expect(hasRendererCapability('dash', 'invoke', ['contractVerification:unknown'])).toBe(true)
  expect(hasRendererCapability('tray', 'invoke', ['contractVerification:unknown'])).toBe(true)
  expect(hasRendererCapability('dapp', 'invoke', ['contractVerification:unknown'])).toBe(false)
  expect(hasRendererCapability('onboard', 'invoke', ['contractVerification:unknown'])).toBe(false)
})

test('limits generated-wallet secret lifecycle RPCs to the dashboard role', () => {
  for (const method of ['beginGeneratedWallet', 'completeGeneratedWallet', 'discardGeneratedWallet']) {
    expect(hasRendererCapability('dash', 'rpc', [method])).toBe(true)
    expect(hasRendererCapability('tray', 'rpc', [method])).toBe(false)
    expect(hasRendererCapability('dapp', 'rpc', [method])).toBe(false)
    expect(hasRendererCapability('onboard', 'rpc', [method])).toBe(false)
  }
})
