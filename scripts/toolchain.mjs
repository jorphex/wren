export function executableForPlatform(command, platform = process.platform) {
  return platform === 'win32' ? `${command}.cmd` : command
}
