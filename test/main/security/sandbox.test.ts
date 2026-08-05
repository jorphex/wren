import { assertSandboxEnabled } from '../../../main/security/sandbox'

const commandLine = (switches: string[] = []) => ({
  hasSwitch: (name: string) => switches.includes(name)
})

it('rejects a production process with Chromium sandboxing disabled', () => {
  expect(() => assertSandboxEnabled(commandLine(['no-sandbox']), 'production')).toThrow(
    'Wren refuses to run without the Chromium sandbox'
  )
})

it('accepts sandboxed production and explicit development processes', () => {
  expect(() => assertSandboxEnabled(commandLine(), 'production')).not.toThrow()
  expect(() => assertSandboxEnabled(commandLine(['no-sandbox']), 'development')).not.toThrow()
})
