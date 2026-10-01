import { v5 as uuid } from 'uuid'

const namespace = '3bbcee75-cecc-5b56-8031-b6641c1ed1f1'

export function trezorSignerId(path: string) {
  return uuid('Trezor' + path, namespace)
}
