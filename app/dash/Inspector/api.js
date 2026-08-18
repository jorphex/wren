import link from '../../../resources/link'

const MAX_ERROR_LENGTH = 240

export const boundedInspectorError = (error) => {
  const message = typeof error === 'string' ? error : error?.message
  if (!message) return 'Wren could not inspect this input.'
  return message.slice(0, MAX_ERROR_LENGTH)
}

export const inspectReadOnlyInput = async (request) => {
  const result = await link.invoke('inspector:inspect', request)
  if (!result || typeof result.success !== 'boolean') {
    throw new Error('Inspector response was unavailable.')
  }
  if (result.success && (!result.inspection || typeof result.inspection !== 'object')) {
    throw new Error('Inspector evidence was unavailable.')
  }
  return result
}
