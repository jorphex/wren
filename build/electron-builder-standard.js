const configs = {
  darwin: './electron-builder-macos.js',
  linux: './electron-builder-linux.js',
  win32: './electron-builder-windows.js'
}

const config = configs[process.platform]
if (!config) throw new Error(`Unsupported build platform: ${process.platform}`)

module.exports = require(config)
