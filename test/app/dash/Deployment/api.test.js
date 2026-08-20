import {
  deploymentByteCount,
  MAX_DEPLOYMENT_BYTES,
  prepareDeployment,
  queueDeployment,
  validateCreationData,
  validateNativeValue
} from '../../../../app/dash/Deployment/api'
import link from '../../../../resources/link'

jest.mock('../../../../resources/link', () => ({ invoke: jest.fn() }))

beforeEach(() => link.invoke.mockReset())

it('validates complete whole-byte creation data within the protocol limit', () => {
  expect(validateCreationData('')).toBe('Deployment data is required.')
  expect(validateCreationData('6000')).toMatch(/begin with 0x/i)
  expect(validateCreationData('0x600')).toMatch(/even number/i)
  expect(validateCreationData('0x60zz')).toMatch(/only hexadecimal/i)
  expect(validateCreationData(`0x${'00'.repeat(MAX_DEPLOYMENT_BYTES + 1)}`)).toMatch(/49,152 bytes/i)
  expect(validateCreationData('0x6000')).toBe('')
  expect(deploymentByteCount('0x6000')).toBe(2)
})

it('accepts only blank or non-negative decimal native values', () => {
  expect(validateNativeValue('')).toBe('')
  expect(validateNativeValue('0')).toBe('')
  expect(validateNativeValue('.25')).toBe('')
  expect(validateNativeValue('1.')).toBe('')
  expect(validateNativeValue('-1')).toMatch(/non-negative decimal/i)
  expect(validateNativeValue('1 ETH')).toMatch(/without units/i)
})

it('uses the strict deployment invoke channels and exact queue envelope', async () => {
  const draft = { account: '0x1', chainId: 1, initcode: '0x6000', value: '' }
  link.invoke.mockResolvedValue({ success: true })

  await prepareDeployment(draft)
  await queueDeployment('inspection-1', draft)

  expect(link.invoke.mock.calls).toEqual([
    ['deployment:prepare', draft],
    ['deployment:queue', { inspectionId: 'inspection-1', draft }]
  ])
})
