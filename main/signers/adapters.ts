import { EventEmitter } from 'stream'
import Signer from './Signer'

export class SignerAdapter extends EventEmitter {
  adapterType: string

  constructor(type: string) {
    super()

    this.adapterType = type
  }

  open() {
    // Optional adapter lifecycle hook.
  }
  close(): void | Promise<void> {
    // Optional adapter lifecycle hook.
  }
  remove(_signer: Signer) {
    // Optional adapter lifecycle hook.
  }
  reload(_signer: Signer) {
    // Optional adapter lifecycle hook.
  }
  dismissAuthentication(_signer: Signer) {
    return false
  }
}
