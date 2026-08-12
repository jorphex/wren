import link from '../../../../resources/link'

const profileResult = (result) => {
  if (!result || typeof result.success !== 'boolean') {
    throw new Error('Profile backup response was unavailable')
  }
  return result
}

export const exportProfileBackup = async (password) =>
  profileResult(await link.invoke('profile:export', password))

export const inspectProfileBackup = async (password) =>
  profileResult(await link.invoke('profile:inspectBackup', password))

export const stageProfileRestore = async (token, password) =>
  profileResult(await link.invoke('profile:stageRestore', token, password, 'REPLACE_PROFILE_ON_RESTART'))
