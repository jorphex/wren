import { SignerAdapter } from '../adapters'
import Signer from '../Signer'

const hot = require('./index') as {
  createScanner: (signers: {
    add: (signer: Signer) => void
    exists: (id: string) => boolean
    unload: (reason: string) => void
  }) => {
    close: () => void
    scan: () => Promise<void>
  }
}

export default class HotSignerAdapter extends SignerAdapter {
  private readonly signerExists: (id: string) => boolean
  private readonly unloadSigners: (reason: string) => void
  private scanner: { close: () => void; scan: () => Promise<void> } | undefined

  constructor(
    signerExists: (id: string) => boolean,
    unloadSigners: (reason: string) => void = () => undefined
  ) {
    super('hot')
    this.signerExists = signerExists
    this.unloadSigners = unloadSigners
  }

  override open() {
    if (this.scanner) return

    this.scanner = hot.createScanner({
      add: (signer) => this.emit('add', signer),
      exists: this.signerExists,
      unload: this.unloadSigners
    })
  }

  override close() {
    this.scanner?.close()
    this.scanner = undefined
  }

  scan() {
    return this.scanner?.scan() || Promise.resolve()
  }

  override remove(signer: Signer) {
    signer.close()
    signer.delete()
  }

  override reload(signer: Signer) {
    signer.close()
    void this.scanner?.scan()
  }
}
