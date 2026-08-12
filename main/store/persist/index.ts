import path from 'path'
import electron from 'electron'
import Conf, { Options } from 'conf'

import migrations from '../migrate'
import { pruneTransientPersistedState, sanitizePersistedStateUpdate } from './state'

type PersistedConfig = Record<string, unknown>
type PersistOpts<T extends PersistedConfig> = Options<T>

class PersistStore extends Conf<PersistedConfig> {
  private blockUpdates = false
  private updates: PersistedConfig | null = {}

  constructor(options?: PersistOpts<PersistedConfig>) {
    options = { configFileMode: 0o600, configName: 'config', ...options }
    let defaultCwd = __dirname
    if (electron && electron.app) defaultCwd = electron.app.getPath('userData')
    if (options.cwd) {
      options.cwd = path.isAbsolute(options.cwd) ? options.cwd : path.join(defaultCwd, options.cwd)
    } else {
      options.cwd = defaultCwd
    }
    electron.app.on('quit', () => this.writeUpdates())
    super(options)
    setInterval(() => this.writeUpdates(), 30 * 1000)
  }

  writeUpdates() {
    if (this.blockUpdates) return

    const updates = { ...this.updates }
    this.updates = null
    if (Object.keys(updates || {}).length > 0) super.set(updates)
  }

  pruneTransientState() {
    const current = super.get('main')
    const pruned = pruneTransientPersistedState(current)
    if (pruned !== current) super.set('main', pruned)
  }

  queue(path: string, value: unknown) {
    const sanitized = sanitizePersistedStateUpdate(path, value)
    if (!sanitized) return
    path = `main.__.${migrations.latest}.${sanitized.path}`
    this.updates = this.updates || {}
    delete this.updates[path] // maintain entry order
    this.updates[path] = JSON.parse(JSON.stringify(sanitized.value))
  }

  override set(path: string | Partial<PersistedConfig>, value?: unknown) {
    if (this.blockUpdates) return
    if (typeof path !== 'string') throw new TypeError('Persisted state path must be a string')
    const sanitized = sanitizePersistedStateUpdate(path, value)
    if (!sanitized) return
    path = `main.__.${migrations.latest}.${sanitized.path}`
    super.set(path, sanitized.value)
  }

  override clear() {
    this.blockUpdates = true
    super.clear()
  }
}

export default new PersistStore()
