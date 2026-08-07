/** @jest-environment jsdom */

import Restore from 'react-restore'

import { NativeControls } from '../../../resources/Native'
import link from '../../../resources/link'
import { render, screen } from '../../componentSetup'

jest.mock('../../../resources/link', () => ({ send: jest.fn() }))

const frameId = 'native-controls-frame'

const renderControls = (platform, frame = {}) => {
  const store = Restore.create(
    {
      platform,
      main: {
        frames: {
          [frameId]: { fullscreen: false, maximized: false, ...frame }
        }
      }
    },
    {}
  )

  class TestNativeControls extends NativeControls {
    constructor(props) {
      super(props, { store })
      this.store = store
    }
  }

  window.frameId = frameId
  return render(<TestNativeControls />)
}

it.each(['linux', 'win32'])('exposes named window controls and preserves IPC events on %s', async (platform) => {
  const { user } = renderControls(platform)

  await user.click(screen.getByRole('button', { name: 'Minimize window' }))
  await user.click(screen.getByRole('button', { name: 'Maximize window' }))
  await user.click(screen.getByRole('button', { name: 'Close window' }))

  expect(link.send.mock.calls).toEqual([['frame:min'], ['frame:max'], ['frame:close']])
})

it.each([
  ['linux', { maximized: true }],
  ['linux', { fullscreen: true }],
  ['win32', { maximized: true }],
  ['win32', { fullscreen: true }]
])('restores a maximized or fullscreen window on %s', async (platform, frame) => {
  const { user } = renderControls(platform, frame)

  await user.click(screen.getByRole('button', { name: 'Restore window' }))

  expect(link.send).toHaveBeenCalledWith('frame:unmax')
  expect(screen.queryByRole('button', { name: 'Maximize window' })).toBeNull()
})

it('leaves macOS window chrome to the native traffic-light controls', () => {
  renderControls('darwin')

  expect(screen.queryAllByRole('button')).toHaveLength(0)
  expect(document.querySelector('.macGrab')).toBeTruthy()
  expect(document.querySelector('.macControls')).toBeTruthy()
})
