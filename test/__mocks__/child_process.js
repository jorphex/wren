const EventEmitter = require('events')

const createForkedChildProcess = () => {
  const childProcess = new EventEmitter()
  childProcess.kill = jest.fn()
  childProcess.send = jest.fn()
  return childProcess
}

module.exports = {
  fork: jest.fn((path, args, opts) => {
    const childProcess = createForkedChildProcess()
    if (opts.signal) {
      opts.signal.onabort = () => {
        childProcess.kill('SIGABRT')
      }
    }

    return childProcess
  })
}
