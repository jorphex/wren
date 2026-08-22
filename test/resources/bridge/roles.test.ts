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

test('limits acknowledged Activity clearing to the tray renderer', () => {
  const channel = 'activity:clear'
  expect(hasRendererCapability('tray', 'invoke', [channel])).toBe(true)
  expect(hasRendererCapability('dash', 'invoke', [channel])).toBe(false)
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
  for (const method of [
    'reserveGeneratedWallet',
    'beginGeneratedWallet',
    'completeGeneratedWallet',
    'discardGeneratedWallet'
  ]) {
    expect(hasRendererCapability('dash', 'rpc', [method])).toBe(true)
    expect(hasRendererCapability('tray', 'rpc', [method])).toBe(false)
    expect(hasRendererCapability('dapp', 'rpc', [method])).toBe(false)
    expect(hasRendererCapability('onboard', 'rpc', [method])).toBe(false)
  }
})

test('limits signer removal to the dashboard role', () => {
  expect(hasRendererCapability('dash', 'rpc', ['removeSigner'])).toBe(true)
  expect(hasRendererCapability('tray', 'rpc', ['removeSigner'])).toBe(false)
  expect(hasRendererCapability('dapp', 'rpc', ['removeSigner'])).toBe(false)
  expect(hasRendererCapability('onboard', 'rpc', ['removeSigner'])).toBe(false)
})

test('limits password-protected signer creation to the dashboard role', () => {
  for (const method of ['createFromKeystore', 'createFromPhrase', 'createFromPrivateKey']) {
    expect(hasRendererCapability('dash', 'rpc', [method])).toBe(true)
    expect(hasRendererCapability('tray', 'rpc', [method])).toBe(false)
    expect(hasRendererCapability('dapp', 'rpc', [method])).toBe(false)
    expect(hasRendererCapability('onboard', 'rpc', [method])).toBe(false)
  }
})

test('allows acknowledged public copies in trusted windows but keeps secret copies dashboard-only', () => {
  const channel = 'tray:writeClipboard'
  const publicCopy = [channel, { secret: false, value: 'public' }]
  const secretCopy = [channel, { secret: true, value: 'secret' }]

  expect(hasRendererCapability('dash', 'invoke', publicCopy)).toBe(true)
  expect(hasRendererCapability('tray', 'invoke', publicCopy)).toBe(true)
  expect(hasRendererCapability('dash', 'invoke', secretCopy)).toBe(true)
  expect(hasRendererCapability('tray', 'invoke', secretCopy)).toBe(false)
  expect(hasRendererCapability('dapp', 'invoke', secretCopy)).toBe(false)
})
