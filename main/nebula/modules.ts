type KuboClient = {
  cat: (path: string, options?: { signal?: AbortSignal }) => AsyncIterable<Uint8Array>
  get: (path: string, options?: { archive?: boolean; signal?: AbortSignal }) => AsyncIterable<Uint8Array>
}

type KuboModule = {
  create: (options: { url: string; headers?: Record<string, string> }) => KuboClient
  globSource: (
    path: string,
    pattern: string,
    options?: { hidden?: boolean; followSymlinks?: boolean }
  ) => AsyncIterable<{ path: string; content?: AsyncIterable<Uint8Array> }>
}

type CidModule = {
  CID: {
    parse: (value: string) => {
      toV1: () => { toString: () => string }
    }
  }
}

type ImportResult = {
  cid: { toV1: () => { toString: () => string } }
  path?: string
}

type UnixFsModule = {
  importer: (
    source: AsyncIterable<{ path: string; content?: AsyncIterable<Uint8Array> }>,
    blockstore: { put: () => Promise<void> },
    options: { profile: 'unixfs-v0-2015'; wrapWithDirectory: true }
  ) => AsyncIterable<ImportResult>
}

// TypeScript compiles import() to require() in this CommonJS project. Keep the
// native import boundary here until the main process itself migrates to ESM.
const nativeImport = new Function('specifier', 'return import(specifier)') as <T>(
  specifier: string
) => Promise<T>

let kuboModule: Promise<KuboModule> | undefined
let cidModule: Promise<CidModule> | undefined
let unixFsModule: Promise<UnixFsModule> | undefined

export function loadCidModule() {
  cidModule ||= nativeImport<CidModule>('multiformats/cid')
  return cidModule
}

export function loadKuboModule() {
  kuboModule ||= nativeImport<KuboModule>('kubo-rpc-client')
  return kuboModule
}

export function loadUnixFsModule() {
  unixFsModule ||= nativeImport<UnixFsModule>('ipfs-unixfs-importer')
  return unixFsModule
}

export type { KuboClient }
