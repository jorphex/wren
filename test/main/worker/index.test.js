import log from 'electron-log'
import { fork } from 'child_process'

import WorkerProcess from '../../../main/worker/process'

jest.mock('child_process')

beforeAll(() => {
  log.transports.console.level = false
})

afterAll(() => {
  log.transports.console.level = 'debug'
})

let worker
const currentChildProcess = () => fork.mock.results.at(-1).value

describe('initializing', () => {
  it('should create a forked process using the provided module', () => {
    worker = new WorkerProcess({
      name: 'test-worker',
      modulePath: './test.js',
      args: ['--someFlag', '-t'],
      env: {
        MY_VAR: 'true'
      }
    })

    expect(fork).toHaveBeenCalledWith('./test.js', ['--someFlag', '-t'], {
      signal: expect.anything(),
      env: expect.objectContaining({
        ELECTRON_RUN_AS_NODE: '1',
        MY_VAR: 'true'
      })
    })
  })

  it('kills the process after the provided timeout', () => {
    jest.useFakeTimers()

    worker = new WorkerProcess({
      name: 'test-worker',
      timeout: 60000
    })

    jest.advanceTimersByTime(60000)

    expect(currentChildProcess().kill).toHaveBeenCalledWith('SIGABRT')

    jest.useRealTimers()
  })
})

describe('events', () => {
  beforeEach(() => {
    worker = new WorkerProcess({ name: 'test-worker', modulePath: './test.js' })
  })

  it('emits an event when a message is received', () => {
    let emittedData = ''

    worker.once('update', (data) => (emittedData = data))

    currentChildProcess().emit('message', { event: 'update', payload: 'hello, world!' })

    expect(emittedData).toBe('hello, world!')
  })

  it('emits worker events without a payload', () => {
    const handler = jest.fn()
    worker.on('update', handler)

    currentChildProcess().emit('message', { event: 'update' })

    expect(handler).toHaveBeenCalledWith(undefined)
  })

  it('ignores malformed worker messages', () => {
    const handler = jest.fn()
    worker.on('update', handler)

    currentChildProcess().emit('message', { event: 1, payload: 'unexpected' })

    expect(handler).not.toHaveBeenCalled()
  })

  it('exits if an error event is received', () => {
    let exitEmitted = false

    worker.once('exit', () => (exitEmitted = true))

    currentChildProcess().emit('error')

    expect(currentChildProcess().kill).toHaveBeenCalled()
    expect(exitEmitted).toBe(true)
  })

  it('exits if an exit event is received', () => {
    let exitEmitted = false

    worker.once('exit', () => (exitEmitted = true))

    currentChildProcess().emit('exit')

    expect(currentChildProcess().kill).toHaveBeenCalled()
    expect(exitEmitted).toBe(true)
  })
})

describe('api', () => {
  beforeEach(() => {
    worker = new WorkerProcess({ name: 'test-worker', modulePath: './test.js' })
  })

  describe('#send', () => {
    it('sends a command and args to the worker process', () => {
      worker.send('testCommand', { fruit: 'orange' }, 'metadata')

      expect(currentChildProcess().send).toHaveBeenCalledWith({
        command: 'testCommand',
        args: [{ fruit: 'orange' }, 'metadata']
      })
    })
  })

  describe('#kill', () => {
    it('emits an exit event', () => {
      let exitEmitted = false

      worker.once('exit', () => (exitEmitted = true))
      worker.kill()

      expect(exitEmitted).toBe(true)
    })

    it('kills the worker process', () => {
      worker.kill('SIGHUP')

      expect(currentChildProcess().kill).toHaveBeenCalledWith('SIGHUP')
    })

    it('removes listeners after emitting the exit event', () => {
      let numExitEvents = 0

      worker.on('exit', () => (numExitEvents += 1))
      worker.kill()
      worker.kill()

      expect(numExitEvents).toBe(1)
    })
  })
})

describe('process isolation', () => {
  it('routes messages only to the worker that owns the forked process', () => {
    const firstWorker = new WorkerProcess({ name: 'first-worker', modulePath: './first.js' })
    const firstChildProcess = currentChildProcess()
    const secondWorker = new WorkerProcess({ name: 'second-worker', modulePath: './second.js' })
    const secondChildProcess = currentChildProcess()
    const firstHandler = jest.fn()
    const secondHandler = jest.fn()
    firstWorker.on('update', firstHandler)
    secondWorker.on('update', secondHandler)

    expect(firstChildProcess).not.toBe(secondChildProcess)
    expect(firstChildProcess.listenerCount('message')).toBe(1)
    expect(secondChildProcess.listenerCount('message')).toBe(1)

    firstChildProcess.emit('message', { event: 'update', payload: 'first' })
    expect(firstHandler).toHaveBeenCalledWith('first')
    expect(secondHandler).not.toHaveBeenCalled()

    secondChildProcess.emit('message', { event: 'update', payload: 'second' })
    expect(secondHandler).toHaveBeenCalledWith('second')
    expect(firstHandler).toHaveBeenCalledTimes(1)
  })
})
