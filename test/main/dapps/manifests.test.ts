import { getPinnedDappManifest } from '../../../main/dapps/manifests'

test('does not retain a pinned legacy Send application', () => {
  expect(getPinnedDappManifest('send.frame.eth')).toBeUndefined()
})

test('leaves user-added applications on their explicit resolution path', () => {
  expect(getPinnedDappManifest('example.eth')).toBeUndefined()
})
