import { safeRemoteImageUrl } from '../../../resources/utils/image'

test('allows bounded HTTPS image URLs', () => {
  expect(safeRemoteImageUrl('https://assets.coingecko.com/icon.png')).toBe(
    'https://assets.coingecko.com/icon.png'
  )
})

test.each([
  'http://assets.example/icon.png',
  'https://user:password@assets.example/icon.png',
  'https://assets.example/icon.png',
  'https://assets.coingecko.com.evil.example/icon.png',
  'https://localhost/icon.png',
  'https://renderer.local/icon.png',
  'https://intranet/icon.png',
  'https://127.0.0.1/icon.png',
  'https://10.0.0.1/icon.png',
  'https://169.254.169.254/latest/meta-data',
  'https://172.20.0.1/icon.png',
  'https://192.168.1.1/icon.png',
  'https://[::1]/icon.png',
  'file:///tmp/icon.png',
  'data:image/svg+xml,<svg/>',
  'javascript:alert(1)',
  'not a URL',
  `https://assets.example/${'x'.repeat(2048)}`
])('rejects unsafe image source %s', (source) => {
  expect(safeRemoteImageUrl(source)).toBe('')
})
