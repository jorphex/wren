import { EventEmitter } from 'events'

import { installSignerPowerLockHandlers } from '../../../main/security/signerLockLifecycle'

it('locks on suspend and screen lock, then removes both handlers', () => {
  const monitor = new EventEmitter()
  const lock = jest.fn()
  const remove = installSignerPowerLockHandlers(monitor, lock)

  monitor.emit('suspend')
  monitor.emit('lock-screen')
  expect(lock.mock.calls).toEqual([['system suspend'], ['screen lock']])

  remove()
  monitor.emit('suspend')
  monitor.emit('lock-screen')
  expect(lock).toHaveBeenCalledTimes(2)
})
