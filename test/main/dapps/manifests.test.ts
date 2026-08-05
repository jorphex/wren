import { getPinnedDappManifest } from '../../../main/dapps/manifests'

test('pins the embedded Send application to reviewed content', () => {
  expect(getPinnedDappManifest('send.frame.eth')).toEqual({
    content: 'bafybeiag6x7b2xh3c23fochm565boiuygmomi3vqjxjad4wax5oldwh6bi',
    version: '0.2-e37d2f3'
  })
})

test('leaves user-added applications on their explicit resolution path', () => {
  expect(getPinnedDappManifest('example.eth')).toBeUndefined()
})
