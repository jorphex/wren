const fs = require('fs')
const { execFileSync } = require('child_process')
const path = require('path')

module.exports = async function (params) {
  if (process.platform !== 'darwin') return // Only notarize the app on macOS
  const { notarize } = await import('@electron/notarize')
  const appId = 'io.github.jorphex.wren' // Same appId in electron-builder
  const appPath = path.join(params.appOutDir, `${params.packager.appInfo.productFilename}.app`)
  if (!fs.existsSync(appPath)) throw new Error(`Cannot find application at: ${appPath}`)

  console.log(`Notarizing ${appId} found at ${appPath}`)

  try {
    await notarize({
      appPath: appPath,
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID
    })

    // verify signed and notarized application
    execFileSync(
      'spctl',
      ['--assess', '--type', 'execute', '--verbose', '--ignore-cache', '--no-cache', appPath],
      {}
    )

    console.log(`Successfully notarized ${appId}`)
  } catch (error) {
    console.error(error)
    throw error
  }
}
