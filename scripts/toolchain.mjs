export function npmCliInvocation(executable = process.execPath, npmCli = process.env.npm_execpath) {
  if (!npmCli) throw new Error('npm_execpath is unavailable; run this check through npm')
  return { executable, args: [npmCli, '--version'] }
}
