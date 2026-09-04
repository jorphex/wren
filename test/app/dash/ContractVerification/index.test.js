import {
  ACTIVE_JOB_REFRESH_MS,
  ContractVerification,
  verificationNetworks
} from '../../../../app/dash/ContractVerification'
import {
  getExplorerCredentialStatus,
  getVerification,
  inspectVerificationArtifact,
  listVerifications,
  openVerificationResult,
  prepareVerification,
  publishVerification,
  publishVerificationToEtherscan,
  refreshVerification,
  reselectVerificationSource,
  selectVerificationArtifact
} from '../../../../app/dash/ContractVerification/api'
import link from '../../../../resources/link'
import { act, fireEvent, render, screen, waitFor } from '../../../componentSetup'

jest.mock('../../../../app/dash/ContractVerification/api', () => ({
  inspectVerificationArtifact: jest.fn(),
  listVerifications: jest.fn(),
  openVerificationResult: jest.fn(),
  getExplorerCredentialStatus: jest.fn(),
  getVerification: jest.fn(),
  prepareVerification: jest.fn(),
  publishVerification: jest.fn(),
  publishVerificationToEtherscan: jest.fn(),
  refreshVerification: jest.fn(),
  reselectVerificationSource: jest.fn(),
  selectVerificationArtifact: jest.fn()
}))
jest.mock('../../../../resources/link', () => ({ send: jest.fn() }))

const address = '0x1111111111111111111111111111111111111111'
const hash = `0x${'ab'.repeat(32)}`
const networks = [
  { id: 8453, name: 'Base' },
  { id: 1, name: 'Ethereum' },
  { id: 10, name: 'Offline', connected: false }
]

const rawArtifact = {
  token: 'artifact-token',
  summary: {
    format: 'solidity-standard-json',
    language: 'Solidity',
    compilerStatus: 'required',
    compilerVersion: null,
    sourceCount: 2,
    contractCandidates: [],
    localRuntimeMatch: false
  }
}

const ambiguousArtifact = {
  token: 'ambiguous-token',
  summary: {
    format: 'hardhat-2-build-info',
    language: 'Solidity',
    compilerStatus: 'included',
    compilerVersion: '0.8.28+commit.7893614a',
    sourceCount: 2,
    contractCandidates: ['src/A.sol:A', 'src/B.sol:B'],
    localRuntimeMatch: true
  }
}

const buildArtifact = {
  token: 'build-token',
  summary: {
    format: 'foundry-build-info',
    language: 'Solidity',
    compilerStatus: 'included',
    compilerVersion: '0.8.28+commit.7893614a',
    sourceCount: 1,
    contractCandidates: ['src/A.sol:A'],
    localRuntimeMatch: true
  }
}

const vyperArtifact = {
  token: 'vyper-token',
  summary: {
    format: 'vyper-solc-json',
    language: 'Vyper',
    compilerStatus: 'included',
    compilerVersion: '0.4.3+commit.bff19ea2',
    sourceCount: 1,
    contractCandidates: [],
    localRuntimeMatch: false
  }
}

const prepared = {
  acknowledgementToken: 'ack-token',
  target: { chainId: 1, address, runtimeCodeHash: hash },
  language: 'Solidity',
  compilerVersion: '0.8.28+commit.7893614a',
  contractIdentifier: 'src/A.sol:A',
  sourceCount: 1,
  localRuntimeMatch: 'matched',
  deploymentSettlement: 'not-applicable'
}

const destinations = [
  { destination: 'sourcify', status: 'published' },
  { destination: 'etherscan-forwarded', status: 'unavailable' },
  { destination: 'blockscout-forwarded', status: 'verified', explorerUrl: 'https://blockscout.com/a' },
  { destination: 'routescan-forwarded', status: 'not-submitted' },
  { destination: 'etherscan-direct', status: 'not-submitted' }
]

const job = {
  id: 'verification-1',
  target: { chainId: 1, address, runtimeCodeHash: hash },
  status: 'partial',
  destinations
}

const choose = async (user, artifact = buildArtifact) => {
  inspectVerificationArtifact.mockResolvedValue({ success: true, artifact })
  await user.click(screen.getByRole('button', { name: 'Choose artifact' }))
  await screen.findByRole('heading', { name: 'Source artifact' })
}

const fillTarget = async (user) => {
  await user.selectOptions(screen.getByLabelText('Network'), '1')
  fireEvent.change(screen.getByLabelText('Contract address'), { target: { value: address } })
}

const confirmNoConstructorArguments = (user) =>
  user.click(screen.getByRole('checkbox', { name: 'This contract has no constructor arguments.' }))

const consentToDirectEtherscan = (user) =>
  user.click(screen.getByRole('checkbox', { name: 'I consent to direct Etherscan submission.' }))

beforeEach(() => {
  for (const mock of [
    inspectVerificationArtifact,
    listVerifications,
    openVerificationResult,
    getExplorerCredentialStatus,
    getVerification,
    prepareVerification,
    publishVerification,
    publishVerificationToEtherscan,
    refreshVerification,
    reselectVerificationSource,
    selectVerificationArtifact
  ]) {
    mock.mockReset()
  }
  link.send.mockReset()
  listVerifications.mockResolvedValue({ success: true, jobs: [] })
  openVerificationResult.mockResolvedValue({ success: true })
  prepareVerification.mockResolvedValue({ success: true, prepared })
  publishVerification.mockResolvedValue({ success: true, job })
})

it('accepts only configured connected networks and renders the shared target fields', async () => {
  listVerifications.mockResolvedValue({ success: true, jobs: [job] })
  expect(verificationNetworks(networks).map(({ id }) => id)).toEqual([8453, 1])
  render(<ContractVerification networks={networks} />)
  const recentSummary = await screen.findByText('Recent verifications')
  expect(screen.getByLabelText('Network').classList.contains('wrenInput')).toBe(true)
  expect(screen.getByLabelText('Contract address').classList.contains('wrenInput')).toBe(true)
  const check = screen.getByRole('button', { name: 'Check source' })
  expect(check.disabled).toBe(true)
  expect(check.compareDocumentPosition(recentSummary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(recentSummary.closest('section')?.classList.contains('contractVerificationRecent')).toBe(true)
  expect(screen.getByRole('button', { name: /0x11111111…11111111.*ethereum.*partial/i })).toBeTruthy()

  fireEvent.change(screen.getByLabelText('Contract address'), { target: { value: '0x1234' } })
  expect(screen.getByLabelText('Contract address').getAttribute('aria-invalid')).toBe('true')
  expect(screen.getByText('Enter a 20-byte hexadecimal address beginning with 0x.')).toBeTruthy()
})

it('loads a bounded flat recent list on the Tools route and opens a saved record explicitly', async () => {
  const recentJobs = Array.from({ length: 12 }, (_, index) => ({
    ...job,
    id: `verification-${index + 1}`
  }))
  listVerifications.mockResolvedValue({ success: true, jobs: recentJobs })
  getVerification.mockResolvedValue({ success: true, job })
  const { user } = render(<ContractVerification networks={networks} />)

  await screen.findByText('Recent verifications')
  expect(listVerifications).toHaveBeenCalledTimes(1)
  const rows = screen.getAllByRole('button', {
    name: /0x11111111…11111111.*ethereum.*partial/i
  })
  expect(rows).toHaveLength(10)
  const [recent] = rows
  await user.click(recent)
  expect(getVerification).toHaveBeenCalledWith('verification-1')
  expect(await screen.findByRole('heading', { name: 'Verification status' })).toBeTruthy()
  expect(screen.queryByText('Recent verifications')).toBeNull()
})

it('renders an operation prefill as immutable flat context', () => {
  render(
    <ContractVerification networks={networks} data={{ operationId: 'operation-1', chainId: 1, address }} />
  )

  expect(screen.getByText('0x11111111…11111111')).toBeTruthy()
  expect(screen.queryByLabelText('Contract address')).toBeNull()
  expect(screen.getByText('Ethereum')).toBeTruthy()
})

it('shows compiler and contract choices only when the artifact requires them', async () => {
  const { user } = render(<ContractVerification networks={networks} />)
  await choose(user, rawArtifact)

  expect(screen.getByLabelText('Exact compiler version')).toBeTruthy()
  expect(screen.getByLabelText('Contract identifier')).toBeTruthy()
  expect(screen.queryByLabelText('Contract')).toBeNull()
  expect(screen.getByText('Checked by Sourcify after publishing')).toBeTruthy()

  inspectVerificationArtifact.mockResolvedValue({ success: true, artifact: ambiguousArtifact })
  await user.click(screen.getByRole('button', { name: 'Replace' }))
  await screen.findByLabelText('Contract')
  expect(screen.queryByLabelText('Exact compiler version')).toBeNull()
  expect(screen.queryByLabelText('Contract identifier')).toBeNull()

  selectVerificationArtifact.mockResolvedValue({
    success: true,
    artifact: {
      token: 'selected-artifact-token',
      summary: { ...ambiguousArtifact.summary, selectedContractIdentifier: 'src/B.sol:B' }
    }
  })
  await user.selectOptions(screen.getByLabelText('Contract'), 'src/B.sol:B')
  await waitFor(() =>
    expect(selectVerificationArtifact).toHaveBeenCalledWith('ambiguous-token', 'src/B.sol:B')
  )
  await waitFor(() => expect(screen.getByLabelText('Contract').value).toBe('src/B.sol:B'))

  inspectVerificationArtifact.mockResolvedValue({ success: true, artifact: buildArtifact })
  await user.click(screen.getByRole('button', { name: 'Replace' }))
  await waitFor(() => expect(screen.queryByLabelText('Exact compiler version')).toBeNull())
  await waitFor(() => expect(screen.queryByLabelText('Contract')).toBeNull())
  expect(screen.getByText('Available')).toBeTruthy()
})

it('labels a Vyper solc_json artifact and uses its embedded compiler version', async () => {
  const { user } = render(<ContractVerification networks={networks} />)
  await choose(user, vyperArtifact)

  expect(screen.getByText('Vyper solc_json')).toBeTruthy()
  expect(screen.getByText('0.4.3+commit.bff19ea2')).toBeTruthy()
  expect(screen.queryByLabelText('Exact compiler version')).toBeNull()
})

it('surfaces a specific artifact validation failure', async () => {
  inspectVerificationArtifact.mockResolvedValue({
    success: false,
    error: 'source-checksum-mismatch'
  })
  const { user } = render(<ContractVerification networks={networks} />)

  await user.click(screen.getByRole('button', { name: 'Choose artifact' }))

  expect((await screen.findByRole('alert')).textContent).toBe(
    'A Vyper source checksum does not match its content.'
  )
})

it('restores focus after cancel without rendering a path or source content', async () => {
  inspectVerificationArtifact.mockResolvedValue({ success: false, canceled: true })
  const { user } = render(<ContractVerification networks={networks} />)
  const trigger = screen.getByRole('button', { name: 'Choose artifact' })
  await user.click(trigger)
  expect(document.activeElement).toBe(trigger)
  expect(document.body.textContent).not.toMatch(/\/home\/|contract source code|secret[_ -]?key/i)
})

it('prepares the exact source selection, shows local evidence, and resets consent on edits', async () => {
  const { user } = render(<ContractVerification networks={networks} />)
  await fillTarget(user)
  await choose(user)
  await user.click(screen.getByRole('button', { name: 'Check source' }))

  await waitFor(() =>
    expect(prepareVerification).toHaveBeenCalledWith({
      artifactToken: 'build-token',
      chainId: 1,
      address,
      contractIdentifier: 'src/A.sol:A'
    })
  )
  expect(await screen.findByText(`Bound to ${hash}`)).toBeTruthy()
  expect(screen.getByText('Matched locally')).toBeTruthy()
  expect(screen.queryByLabelText('Contract address')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Replace' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Publish source' }).disabled).toBe(true)

  await user.click(screen.getByRole('checkbox'))
  expect(screen.getByRole('button', { name: 'Publish source' }).disabled).toBe(false)
  await user.click(screen.getByRole('button', { name: 'Edit and recheck' }))
  expect(screen.queryByRole('checkbox')).toBeNull()
  expect(screen.getByText('Choose the artifact again, then check source.')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Choose artifact' })).toBeTruthy()
  expect(screen.getByLabelText('Contract address')).toBeTruthy()
})

it('announces source checking while the read-only check is in flight', async () => {
  let resolveCheck
  prepareVerification.mockReturnValue(new Promise((resolve) => (resolveCheck = resolve)))
  const { user } = render(<ContractVerification networks={networks} />)
  await fillTarget(user)
  await choose(user)
  await user.click(screen.getByRole('button', { name: 'Check source' }))

  expect(screen.getByRole('status').textContent).toBe('Checking source… Nothing has been published.')
  await act(async () => resolveCheck({ success: true, prepared }))
})

it('fails closed while managed deployment finality is pending', async () => {
  prepareVerification.mockResolvedValue({
    success: true,
    prepared: { ...prepared, deploymentSettlement: 'pending' }
  })
  const { user } = render(
    <ContractVerification networks={networks} data={{ operationId: 'operation-1', chainId: 1, address }} />
  )
  await choose(user)
  await user.click(screen.getByRole('button', { name: 'Check source' }))

  expect(await screen.findByText('Waiting for finality')).toBeTruthy()
  expect(screen.getByRole('checkbox').disabled).toBe(true)
  expect(screen.getByRole('button', { name: 'Publish source' }).disabled).toBe(true)
})

it('fails closed when runtime or match evidence is unavailable', async () => {
  prepareVerification.mockResolvedValue({
    success: true,
    prepared: {
      ...prepared,
      target: { chainId: 1, address },
      localRuntimeMatch: 'unavailable',
      deploymentSettlement: undefined
    }
  })
  const { user } = render(<ContractVerification networks={networks} />)
  await fillTarget(user)
  await choose(user)
  await user.click(screen.getByRole('button', { name: 'Check source' }))

  expect(await screen.findAllByText('Unavailable')).toHaveLength(3)
  expect(screen.getByRole('checkbox').disabled).toBe(true)
  expect(screen.getByRole('button', { name: 'Publish source' }).disabled).toBe(true)
})

it('publishes once with explicit acknowledgement and replaces the composer with destination rows', async () => {
  let resolvePublish
  publishVerification.mockImplementation(() => new Promise((resolve) => (resolvePublish = resolve)))
  const { user } = render(<ContractVerification networks={networks} />)
  await fillTarget(user)
  await choose(user)
  await user.click(screen.getByRole('button', { name: 'Check source' }))
  expect(
    await screen.findByText(
      /selected Solidity or Vyper source artifact and verification metadata to Sourcify/
    )
  ).toBeTruthy()
  expect(screen.getByText(/Sourcify may forward them to Etherscan, Blockscout, or Routescan/)).toBeTruthy()
  await user.click(await screen.findByRole('checkbox'))
  await user.click(screen.getByRole('button', { name: 'Publish source' }))
  fireEvent.click(screen.getByRole('button', { name: 'Publishing source…' }))
  expect(publishVerification).toHaveBeenCalledTimes(1)
  expect(publishVerification).toHaveBeenCalledWith('ack-token')
  expect(screen.getByRole('button', { name: 'Publishing source…' }).disabled).toBe(true)
  expect(screen.getByRole('status').textContent).toBe('Publishing source…')

  resolvePublish({ success: true, job })
  expect(await screen.findByRole('heading', { name: 'Verification status' })).toBeTruthy()
  expect(
    screen.getByText('Source was published, but one or more explorer checks need attention.')
  ).toBeTruthy()
  expect(screen.getByText('Blockscout')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Check source' })).toBeNull()
})

it('opens the existing job when duplicate protection finds an equivalent publication', async () => {
  publishVerification.mockResolvedValue({ success: false, error: 'already-submitted', job })
  const { user } = render(<ContractVerification networks={networks} />)
  await fillTarget(user)
  await choose(user)
  await user.click(screen.getByRole('button', { name: 'Check source' }))
  await user.click(await screen.findByRole('checkbox'))
  await user.click(screen.getByRole('button', { name: 'Publish source' }))

  expect(await screen.findByRole('heading', { name: 'Verification status' })).toBeTruthy()
  expect(screen.getByRole('status').textContent).toBe('Existing submission opened.')
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Publish source' })).toBeNull()
  expect(publishVerification).toHaveBeenCalledTimes(1)
})

it('loads existing results, refreshes only on request, and opens external results explicitly', async () => {
  getVerification.mockResolvedValue({ success: true, job })
  refreshVerification.mockResolvedValue({ success: true, job: { ...job, status: 'published' } })
  const { user } = render(
    <ContractVerification networks={networks} data={{ verificationId: 'verification-1' }} />
  )
  expect(await screen.findByText('Verification status')).toBeTruthy()
  expect(refreshVerification).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Refresh status' }))
  expect(refreshVerification).toHaveBeenCalledWith('verification-1')
  await screen.findByText('Status refreshed.')
  await user.click(screen.getByRole('button', { name: 'Open result' }))
  await waitFor(() =>
    expect(openVerificationResult).toHaveBeenCalledWith('verification-1', 'blockscout-forwarded')
  )
})

it('observes an active checking job locally without refreshing or resubmitting it', async () => {
  const checkingJob = {
    ...job,
    status: 'publishing',
    destinations: destinations.map((entry) =>
      entry.destination === 'sourcify'
        ? { ...entry, status: 'checking', remoteId: 'verification-ticket' }
        : entry
    )
  }
  const completedJob = {
    ...checkingJob,
    status: 'published',
    destinations: checkingJob.destinations.map((entry) =>
      entry.destination === 'sourcify' ? { ...entry, status: 'published' } : entry
    )
  }
  getVerification
    .mockResolvedValueOnce({ success: true, job: checkingJob })
    .mockResolvedValueOnce({ success: true, job: completedJob })
  const view = render(
    <ContractVerification active networks={networks} data={{ verificationId: 'verification-1' }} />
  )
  expect(await screen.findByText('Verification status')).toBeTruthy()
  expect(screen.getByRole('status').textContent).toBe('1 verification destination checking.')

  await act(async () => {
    jest.advanceTimersByTime(ACTIVE_JOB_REFRESH_MS)
    await Promise.resolve()
  })
  expect(getVerification).toHaveBeenCalledTimes(2)
  expect(screen.getByText('Verification status updated.')).toBeTruthy()
  expect(screen.getByText('Published')).toBeTruthy()
  expect(refreshVerification).not.toHaveBeenCalled()
  expect(publishVerification).not.toHaveBeenCalled()

  view.unmount()
})

it('observes the persisted Sourcify publication handoff and cleans up its active-only timer', async () => {
  const handedOffJob = {
    ...job,
    status: 'publishing',
    destinations: destinations.map((entry) =>
      entry.destination === 'sourcify' ? { ...entry, status: 'not-submitted' } : entry
    )
  }
  getVerification.mockResolvedValue({ success: true, job: handedOffJob })
  const view = render(
    <ContractVerification active networks={networks} data={{ verificationId: 'verification-1' }} />
  )
  expect(await screen.findByText('Verification status')).toBeTruthy()

  await act(async () => {
    jest.advanceTimersByTime(ACTIVE_JOB_REFRESH_MS)
    await Promise.resolve()
  })
  expect(getVerification).toHaveBeenCalledTimes(2)
  expect(refreshVerification).not.toHaveBeenCalled()
  expect(publishVerification).not.toHaveBeenCalled()

  view.rerender(
    <ContractVerification active={false} networks={networks} data={{ verificationId: 'verification-1' }} />
  )
  await act(async () => {
    jest.advanceTimersByTime(ACTIVE_JOB_REFRESH_MS * 2)
    await Promise.resolve()
  })
  expect(getVerification).toHaveBeenCalledTimes(2)

  view.rerender(
    <ContractVerification active networks={networks} data={{ verificationId: 'verification-1' }} />
  )
  view.unmount()
  await act(async () => {
    jest.advanceTimersByTime(ACTIVE_JOB_REFRESH_MS * 2)
    await Promise.resolve()
  })
  expect(getVerification).toHaveBeenCalledTimes(2)
})

it('stops checking-job observation while hidden and after unmount', async () => {
  const checkingJob = {
    ...job,
    destinations: destinations.map((entry) =>
      entry.destination === 'sourcify' ? { ...entry, status: 'checking' } : entry
    )
  }
  getVerification.mockResolvedValue({ success: true, job: checkingJob })
  const view = render(
    <ContractVerification active networks={networks} data={{ verificationId: 'verification-1' }} />
  )
  expect(await screen.findByText('Verification status')).toBeTruthy()
  view.rerender(
    <ContractVerification active={false} networks={networks} data={{ verificationId: 'verification-1' }} />
  )

  await act(async () => {
    jest.advanceTimersByTime(ACTIVE_JOB_REFRESH_MS * 2)
    await Promise.resolve()
  })
  expect(getVerification).toHaveBeenCalledTimes(1)

  view.rerender(
    <ContractVerification active networks={networks} data={{ verificationId: 'verification-1' }} />
  )
  view.unmount()
  await act(async () => {
    jest.advanceTimersByTime(ACTIVE_JOB_REFRESH_MS * 2)
    await Promise.resolve()
  })
  expect(getVerification).toHaveBeenCalledTimes(1)
})

it('returns quietly from a saved job to a fresh contract check', async () => {
  getVerification.mockResolvedValue({ success: true, job })
  const { user } = render(
    <ContractVerification networks={networks} data={{ verificationId: 'verification-1' }} />
  )
  await screen.findByText('Verification status')
  await user.click(screen.getByRole('button', { name: 'Check another contract' }))

  const addressInput = screen.getByLabelText('Contract address')
  expect(addressInput.value).toBe('')
  expect(document.activeElement).toBe(addressInput)
  expect(screen.getByRole('button', { name: 'Choose artifact' })).toBeTruthy()
  expect(screen.queryByText('Verification status')).toBeNull()
  expect(listVerifications).toHaveBeenCalledTimes(1)
})

it('checks credential status without exposing a key and opens Settings on the existing nav stack', async () => {
  getVerification.mockResolvedValue({ success: true, job })
  getExplorerCredentialStatus.mockResolvedValue({
    success: true,
    credential: { available: true, configured: false, backend: 'safeStorage' }
  })
  const { user } = render(
    <ContractVerification networks={networks} data={{ verificationId: 'verification-1' }} />
  )
  await screen.findByText('Verification status')
  await confirmNoConstructorArguments(user)
  await consentToDirectEtherscan(user)
  await user.click(screen.getByRole('button', { name: 'Submit directly with API key' }))
  expect(publishVerificationToEtherscan).not.toHaveBeenCalled()
  expect(await screen.findByText(/No Etherscan API key is configured/)).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Open Settings' }))
  expect(link.send).toHaveBeenCalledWith('tray:action', 'navDash', { view: 'settings', data: {} })
  expect(document.body.textContent).not.toContain('my-secret-explorer-key')
})

it('submits the direct fallback only after confirming a configured credential', async () => {
  getVerification.mockResolvedValue({
    success: true,
    job: {
      ...job,
      destinations: destinations.map((entry) =>
        entry.destination === 'etherscan-forwarded'
          ? { ...entry, status: 'unknown', reasonCode: 'status-unavailable' }
          : entry
      )
    }
  })
  getExplorerCredentialStatus.mockResolvedValue({
    success: true,
    credential: { available: true, configured: true, backend: 'safeStorage' }
  })
  publishVerificationToEtherscan.mockResolvedValue({
    success: true,
    job: {
      ...job,
      destinations: destinations.map((entry) =>
        entry.destination === 'etherscan-direct' ? { ...entry, status: 'checking' } : entry
      )
    }
  })
  const { user } = render(
    <ContractVerification networks={networks} data={{ verificationId: 'verification-1' }} />
  )
  await screen.findByText('Verification status')
  await confirmNoConstructorArguments(user)
  expect(screen.getByRole('button', { name: 'Submit directly with API key' }).disabled).toBe(true)
  expect(
    screen.getByText(
      /already-checked source, metadata, and any encoded constructor arguments directly to Etherscan/
    )
  ).toBeTruthy()
  await consentToDirectEtherscan(user)
  await user.click(screen.getByRole('button', { name: 'Submit directly with API key' }))
  await waitFor(() => expect(publishVerificationToEtherscan).toHaveBeenCalledWith('verification-1', '', true))
  expect(await screen.findByText('Checking')).toBeTruthy()
})

it('invalidates direct consent when constructor arguments change', async () => {
  getVerification.mockResolvedValue({ success: true, job })
  const { user } = render(
    <ContractVerification networks={networks} data={{ verificationId: 'verification-1' }} />
  )
  await screen.findByText('Verification status')
  const argumentsInput = screen.getByRole('textbox', { name: 'Encoded constructor arguments' })
  expect(screen.getByText('Paste encoded constructor arguments, or confirm there are none.')).toBeTruthy()
  await user.type(argumentsInput, '0x')
  expect(argumentsInput.getAttribute('aria-invalid')).toBe('true')
  expect(screen.getByText('Use an even number of hexadecimal characters without 0x.')).toBeTruthy()
  await user.clear(argumentsInput)
  await user.type(argumentsInput, '12Ab')
  await consentToDirectEtherscan(user)
  expect(screen.getByRole('button', { name: 'Submit directly with API key' }).disabled).toBe(false)

  await user.type(argumentsInput, '34')

  expect(screen.getByRole('button', { name: 'Submit directly with API key' }).disabled).toBe(true)
})

it('retries a key-failed direct POST only without a remote id', async () => {
  const needsKey = {
    ...job,
    destinations: destinations.map((entry) =>
      entry.destination === 'etherscan-direct' ? { ...entry, status: 'needs-api-key' } : entry
    )
  }
  getVerification.mockResolvedValue({ success: true, job: needsKey })
  const view = render(
    <ContractVerification networks={networks} data={{ verificationId: 'verification-1' }} />
  )
  expect(await screen.findByRole('button', { name: 'Submit directly with API key' })).toBeTruthy()
  expect(screen.getByText(/Replace the Etherscan API key before trying again/)).toBeTruthy()
  view.unmount()

  const pollingJob = {
    ...needsKey,
    destinations: needsKey.destinations.map((entry) =>
      entry.destination === 'etherscan-direct' ? { ...entry, remoteId: 'existing-guid' } : entry
    )
  }
  getVerification.mockResolvedValue({ success: true, job: pollingJob })
  render(<ContractVerification networks={networks} data={{ verificationId: 'verification-1' }} />)
  expect(await screen.findByText(/then refresh the existing submission/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Submit directly with API key' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Refresh status' })).toBeTruthy()
})

it.each([
  [
    'transport-failure',
    'Etherscan’s response was not confirmed. Wren will not submit this publication again; check the contract on Etherscan later.'
  ],
  [
    'status-unavailable',
    'Wren cannot confirm whether direct publication began. It will not submit this publication again; check the contract on Etherscan later.'
  ]
])('explains a terminal direct unknown result for %s without offering replay', async (reasonCode, copy) => {
  const unknownDirect = {
    ...job,
    destinations: destinations.map((entry) =>
      entry.destination === 'etherscan-direct'
        ? { ...entry, status: 'unknown', reasonCode, publicationHash: hash.slice(2) }
        : entry
    )
  }
  getVerification.mockResolvedValue({ success: true, job: unknownDirect })

  render(<ContractVerification networks={networks} data={{ verificationId: 'verification-1' }} />)

  expect(await screen.findByText(copy)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Submit directly with API key' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Refresh status' })).toBeTruthy()
})

it('offers explicit source reselection after restart and validates the restored identity', async () => {
  getVerification.mockResolvedValue({ success: true, job })
  getExplorerCredentialStatus.mockResolvedValue({
    success: true,
    credential: { available: true, configured: true }
  })
  publishVerificationToEtherscan.mockResolvedValue({
    success: false,
    error: 'source-reselection-required',
    job
  })
  reselectVerificationSource.mockResolvedValue({ success: true, job })
  const { user } = render(
    <ContractVerification networks={networks} data={{ verificationId: 'verification-1' }} />
  )
  await screen.findByText('Verification status')
  await confirmNoConstructorArguments(user)
  await consentToDirectEtherscan(user)
  await user.click(screen.getByRole('button', { name: 'Submit directly with API key' }))
  await user.click(await screen.findByRole('button', { name: 'Reselect source' }))
  await choose(user)
  await user.click(screen.getByRole('button', { name: 'Restore source' }))
  expect(reselectVerificationSource).toHaveBeenCalledWith({
    jobId: 'verification-1',
    artifactToken: 'build-token',
    contractIdentifier: 'src/A.sol:A'
  })
})

it('focuses fixed errors and ignores stale completion after unmount', async () => {
  let resolve
  inspectVerificationArtifact.mockImplementation(() => new Promise((done) => (resolve = done)))
  const view = render(<ContractVerification networks={networks} />)
  await view.user.click(screen.getByRole('button', { name: 'Choose artifact' }))
  view.unmount()
  resolve({ success: false, error: 'invalid-artifact', source: 'must not render' })
  await waitFor(() => expect(document.body.textContent).not.toContain('must not render'))

  inspectVerificationArtifact.mockResolvedValue({ success: false, error: 'invalid-artifact' })
  const { user } = render(<ContractVerification networks={networks} />)
  await user.click(screen.getByRole('button', { name: 'Choose artifact' }))
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe('Wren could not use this verification artifact.')
  expect(document.activeElement).toBe(alert)
  expect(screen.getAllByRole('status')).toHaveLength(1)
})
