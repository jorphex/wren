import { SignerAdapter } from '../adapters'
import Signer from '../Signer'

const hot = require('./index') as {
  createScanner: (signers: { add: (signer: Signer) => void; exists: (id: string) => boolean }) => {
    close: () => void
    scan: () => Promise<void>
  }
}

export default class HotSignerAdapter extends SignerAdapter {
  private readonly signerExists: (id: string) => boolean
  private scanner: { close: () => void; scan: () => Promise<void> } | undefined

  constructor(signerExists: (id: string) => boolean) {
    super('hot')
    this.signerExists = signerExists
  }

  override open() {
    if (this.scanner) return

    this.scanner = hot.createScanner({
      add: (signer) => this.emit('add', signer),
      exists: this.signerExists
    })
  }

  override close() {
    this.scanner?.close()
    this.scanner = undefined
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
