import fs from 'fs'

const style = fs.readFileSync('app/dash/Accounts/Add/style/index.styl', 'utf8')

test('keeps commit controls reachable and expiry guidance above muted footnotes', () => {
  expect(style).toMatch(
    /\.generatedWalletSessionNote\.generatedWalletExpiryNotice\n\s+color var\(--wren-text-secondary\)\n\s+font-weight 500/
  )
  expect(style).toMatch(/&\.generatedWalletSetup[\s\S]*?\.addAccountItemOptionSubmit\n\s+min-height 44px/)
})
