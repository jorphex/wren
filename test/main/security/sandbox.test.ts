import { assertSandboxEnabled } from '../../../main/security/sandbox'

const commandLine = (switches: string[] = []) => ({
  hasSwitch: (name: string) => switches.includes(name)
})

it('rejects packaged and production processes with Chromium sandboxing disabled', () => {
  expect(() => assertSandboxEnabled(commandLine(['no-sandbox']), undefined)).toThrow(
    'Wren refuses to run without the Chromium sandbox'
  )
  expect(() => assertSandboxEnabled(commandLine(['no-sandbox']), 'production')).toThrow(
    'Wren refuses to run without the Chromium sandbox'
  )
})

it('accepts sandboxed production and explicit development processes', () => {
  expect(() => assertSandboxEnabled(commandLine(), 'production')).not.toThrow()
  expect(() => assertSandboxEnabled(commandLine(['no-sandbox']), 'development')).not.toThrow()
})
