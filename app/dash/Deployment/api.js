import link from '../../../resources/link'

export const MAX_DEPLOYMENT_BYTES = 49_152
export const MAX_DEPLOYMENT_HEX_LENGTH = 2 + MAX_DEPLOYMENT_BYTES * 2
export const MAX_DEPLOYMENT_VALUE_LENGTH = 512

const DECIMAL_VALUE = /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/u
const HEX_VALUE = /^[0-9a-fA-F]*$/u

export const deploymentByteCount = (value) => {
  if (typeof value !== 'string' || !value.startsWith('0x')) return 0
  return Math.floor((value.length - 2) / 2)
}

export const validateCreationData = (value) => {
  if (!value) return 'Deployment data is required.'
  if (!value.startsWith('0x')) {
    return 'Deployment data must begin with 0x and contain an even number of hexadecimal characters.'
  }
  if (!HEX_VALUE.test(value.slice(2))) {
    return 'Deployment data can contain only hexadecimal characters after 0x.'
  }
  if (value.length === 2 || value.length % 2 !== 0) {
    return 'Deployment data must begin with 0x and contain an even number of hexadecimal characters.'
  }
  if (value.length > MAX_DEPLOYMENT_HEX_LENGTH) {
    return 'Deployment data cannot exceed 49,152 bytes.'
  }
  return ''
}

export const validateNativeValue = (value) => {
  if (value === '') return ''
  if (value.length > MAX_DEPLOYMENT_VALUE_LENGTH || !DECIMAL_VALUE.test(value)) {
    return 'Enter a non-negative decimal value without units or separators.'
  }
  return ''
}

export const prepareDeployment = (draft) => link.invoke('deployment:prepare', draft)

export const queueDeployment = (inspectionId, draft) =>
  link.invoke('deployment:queue', { inspectionId, draft })
