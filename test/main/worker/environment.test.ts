import { nodeWorkerEnvironment, signerWorkerEnvironment } from '../../../main/worker/environment'

describe('node worker environment', () => {
  it('inherits the parent environment and applies worker overrides', () => {
    const environment = nodeWorkerEnvironment({ FRAME_WORKER_TEST: 'worker' })

    expect(environment.PATH).toBe(process.env.PATH)
    expect(environment.FRAME_WORKER_TEST).toBe('worker')
  })

  it('cannot be configured to launch the Electron application', () => {
    const environment = nodeWorkerEnvironment({ ELECTRON_RUN_AS_NODE: '0' })

    expect(environment.ELECTRON_RUN_AS_NODE).toBe('1')
  })
})

describe('hot signer worker environment', () => {
  it('keeps runtime paths while excluding parent credentials and Node injection options', () => {
    const environment = signerWorkerEnvironment({
      HOME: '/test/home',
      NODE_OPTIONS: '--require=/tmp/injected.js',
      RELEASE_TOKEN: 'secret',
      PATH: '/test/bin'
    })

    expect(environment).toEqual({
      ELECTRON_RUN_AS_NODE: '1',
      HOME: '/test/home',
      PATH: '/test/bin'
    })
  })
})
