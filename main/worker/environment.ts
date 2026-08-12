export function nodeWorkerEnvironment(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...overrides,
    ELECTRON_RUN_AS_NODE: '1'
  }
}

const SIGNER_WORKER_ENVIRONMENT_KEYS = [
  'APPDATA',
  'HOME',
  'LANG',
  'LC_ALL',
  'LOCALAPPDATA',
  'PATH',
  'SystemRoot',
  'TEMP',
  'TMP',
  'TMPDIR',
  'TZ',
  'USERPROFILE',
  'WINDIR'
] as const

export function signerWorkerEnvironment(parent = process.env): NodeJS.ProcessEnv {
  const environment: Partial<NodeJS.ProcessEnv> = { ELECTRON_RUN_AS_NODE: '1' }
  SIGNER_WORKER_ENVIRONMENT_KEYS.forEach((key) => {
    if (parent[key] !== undefined) environment[key] = parent[key]
  })
  return environment as NodeJS.ProcessEnv
}
