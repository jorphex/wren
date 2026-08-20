import link from '../../../resources/link'

const requestYearnCatalog = async (options) => {
  const result = await link.invoke('yearn:getCatalog', options)
  if (
    !result ||
    !Array.isArray(result.vaults) ||
    !['fresh', 'stale', 'unavailable'].includes(result.status)
  ) {
    throw new Error('Yearn catalog response was unavailable')
  }
  return result
}

export const getYearnCatalog = async (force = false) => requestYearnCatalog({ force })

export const getYearnCatalogSnapshot = async () => requestYearnCatalog({ force: false, cacheOnly: true })

export const getYearnPositions = async () => {
  const result = await link.invoke('yearn:getPositions')
  if (!result || !Array.isArray(result.chains)) throw new Error('Yearn positions response was unavailable')
  return result
}

export const getYearnWorkflows = async () => {
  const result = await link.invoke('yearn:getWorkflows')
  if (!result || !Array.isArray(result.workflows)) throw new Error('Yearn workflows were unavailable')
  return result
}

const workflowResult = (result) => {
  if (!result || typeof result.success !== 'boolean')
    throw new Error('Yearn workflow response was unavailable')
  if (!result.success) throw new Error(result.error)
  return result.workflow
}

export const startYearnWorkflow = async (request) =>
  workflowResult(await link.invoke('yearn:startWorkflow', request))
export const resumeYearnWorkflow = async (id) =>
  workflowResult(await link.invoke('yearn:resumeWorkflow', { id }))
export const cancelYearnWorkflow = async (id) =>
  workflowResult(await link.invoke('yearn:cancelWorkflow', { id }))
export const revokeYearnWorkflow = async (id) =>
  workflowResult(await link.invoke('yearn:revokeWorkflow', { id }))
