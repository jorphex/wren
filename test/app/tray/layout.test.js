import fs from 'fs'

const accountStyle = fs.readFileSync('app/tray/Account/style/account.styl', 'utf8')
const accountSource = fs.readFileSync('app/tray/Account/Account.js', 'utf8')
const accountSelectorStyle = fs.readFileSync('app/tray/AccountSelector/style/index.styl', 'utf8')
const balancesStyle = fs.readFileSync('app/tray/Account/Balances/style/index.styl', 'utf8')
const inventoryStyle = fs.readFileSync('app/tray/Account/Inventory/style/index.styl', 'utf8')
const notifyStyle = fs.readFileSync('app/tray/Notify/style/index.styl', 'utf8')
const signerStyle = fs.readFileSync('app/tray/Account/Signer/style/index.styl', 'utf8')
const walletCallsStyle = fs.readFileSync('app/tray/Account/Requests/style/wren-wallet-calls.styl', 'utf8')
const signingStyle = fs.readFileSync('app/tray/Account/Requests/style/wren-signing.styl', 'utf8')
const revokeStyle = fs.readFileSync('app/tray/Account/Requests/style/wren-eip7702-revoke.styl', 'utf8')

test('keeps account collection and balance interiors on one ruled ledger', () => {
  expect(accountStyle).toMatch(
    /\.accountLedgerView[\s\S]*?> \._txMain[\s\S]*?border 0[\s\S]*?background transparent[\s\S]*?\.cluster[\s\S]*?border-top 1px solid var\(--wren-ledger-rule\)[\s\S]*?\.clusterRow[\s\S]*?border-bottom 1px solid var\(--wren-ledger-rule\)/
  )
})

test('keeps the first account row and compact account controls free of duplicate rules', () => {
  expect(accountStyle).toMatch(
    /\.accountMainSlide > \.accountModule:first-child[\s\S]*?\.accountModuleCard[\s\S]*?border-top 0/
  )
  expect(accountStyle).toMatch(/\.requestsPreview\n {2}height 48px\n {2}border 0\n {2}border-radius 0/)
  expect(signerStyle).toMatch(
    /\.signerPreviewSummary[\s\S]*?display flex[\s\S]*?justify-content space-between/
  )
  expect(accountStyle).toMatch(
    /\.accountLedgerModule[\s\S]*?\.accountLedgerRow[\s\S]*?min-height 52px[\s\S]*?\.accountLedgerLabel[\s\S]*?flex 0 0 112px/
  )
})

test('keeps network switching, chain explorer, and gas evidence as distinct controls', () => {
  expect(accountSource).not.toMatch(/accountHomeExplorer/)
  expect(accountStyle).toMatch(
    /\.chainMonitorNetworkRow,[\s\S]*?\.chainMonitorGasRow[\s\S]*?grid-template-columns minmax\(0, 1fr\) auto/
  )
  expect(accountStyle).toMatch(
    /\.chainMonitorSwitchButton,[\s\S]*?\.chainMonitorExplorer[\s\S]*?min-height 44px/
  )
  expect(accountStyle).toMatch(
    /\.chainMonitorGasEvidence[\s\S]*?justify-content space-between[\s\S]*?\.chainMonitorDisclosure[\s\S]*?min-height 44px/
  )
  expect(accountStyle).toMatch(/\.accountHomeAddress[\s\S]*?min-height 44px/)
  expect(accountSource).toMatch(/wrenControlPrimary wrenControlLarge/)
})

test('keeps the account selector and privacy control on one optical axis', () => {
  expect(accountSelectorStyle).toMatch(/\.accountSwitcherTrigger[\s\S]*?height 40px/)
  expect(accountSelectorStyle).toMatch(/\.accountPrivacyToggle[\s\S]*?width 40px[\s\S]*?height 40px/)
})

test('lets transparent account artwork merge with the ruled ledger canvas', () => {
  expect(accountStyle).toMatch(
    /\.wrenEmptyStateImageTransparent[\s\S]*?opacity 1[\s\S]*?filter none[\s\S]*?mask-image none/
  )
  expect(accountStyle).toMatch(
    /\.wrenEmptyStateTransparent:not\(\.wrenEmptyStateExpanded\)[\s\S]*?min-height 96px[\s\S]*?top 45%/
  )
  expect(balancesStyle).toMatch(
    /\.signerBalancesLoading[\s\S]*?position relative[\s\S]*?min-height 88px[\s\S]*?background transparent/
  )
})

test('keeps ordered wallet calls on a flat ruled ledger', () => {
  expect(walletCallsStyle).toMatch(
    /\.walletCall[\s\S]*?border-top 1px solid var\(--wren-ledger-rule\)[\s\S]*?border-radius 0[\s\S]*?background transparent[\s\S]*?box-shadow none/
  )
})

test('keeps transaction review on one flat details ledger', () => {
  expect(accountSource).toMatch(
    /style=\{\{[\s\S]*?top: requestMode \|\| compactTop \? '68px' : accountOpen \? '140px' : '80px'/
  )
  expect(accountSource).toMatch(/requestMode=\{true\}/)
  expect(accountStyle).toMatch(
    /\.accountView[\s\S]*?&:has\(\.signerRequest\)[\s\S]*?\.accountViewMain[\s\S]*?top 52px/
  )
  expect(signingStyle).toMatch(
    /\.requestItem,[\s\S]*?border-radius 0[\s\S]*?background transparent[\s\S]*?\.transactionReviewSectionTitle/
  )
  expect(signingStyle).toMatch(
    /\.transactionReviewRecipient,[\s\S]*?\.transactionReviewFee,[\s\S]*?\.transactionReviewNonce[\s\S]*?margin 0/
  )
  expect(signingStyle).toMatch(
    /\.transactionReviewFeeRow,[\s\S]*?\.transactionReviewNonceRow[\s\S]*?grid-template-columns 112px minmax\(0, 1fr\) auto/
  )
  expect(signingStyle).toMatch(
    /\.transactionNonce[\s\S]*?grid-column 2 \/ 4[\s\S]*?grid-template-columns minmax\(0, 1fr\) auto/
  )
  expect(signingStyle).toMatch(
    /\.transactionReviewMain[\s\S]*?> \.clusterRow:first-child \.clusterValue[\s\S]*?min-height 116px/
  )
  expect(signingStyle).toMatch(
    /\.transactionReviewSummaryStatus[\s\S]*?justify-self end[\s\S]*?text-align right/
  )
  expect(signingStyle).toMatch(
    /\.transactionReviewSummaryStatus[\s\S]*?min-height 54px[\s\S]*?align-items center/
  )
  expect(signingStyle).toMatch(/\.clusterValue[\s\S]*?justify-content flex-start[\s\S]*?text-align left/)
})

test('keeps signing evidence readable and operable when the shell is scaled', () => {
  expect(signingStyle).toMatch(/\.txLifecycleStep[\s\S]*?font-size 12px/)
  expect(signingStyle).toMatch(
    /\.txLifecycleAction,[\s\S]*?\.txLifecycleDetails button,[\s\S]*?\.txLifecycleCancelRequest[\s\S]*?min-height 44px[\s\S]*?height 44px/
  )
  expect(signingStyle).toMatch(
    /@media \(max-width: 560px\)[\s\S]*?\.approveTransaction \.transactionReviewMain[\s\S]*?\._txDescription[\s\S]*?grid-template-columns minmax\(0, 1fr\)[\s\S]*?\.transactionReviewSummaryStatus[\s\S]*?width 100%[\s\S]*?max-width none/
  )
})

test('keeps delegation revocation readable and operable at scaled narrow widths', () => {
  expect(revokeStyle).toMatch(
    /\.eip7702RevokeRequestSummary[\s\S]*?font-family var\(--wren-font-ui\)[\s\S]*?> span[\s\S]*?font-family var\(--wren-font-mono\)/
  )
  expect(revokeStyle).toMatch(
    /\.eip7702RevokeFeeRow[\s\S]*?min-height 52px[\s\S]*?> button[\s\S]*?min-height 44px/
  )
  expect(revokeStyle).toMatch(
    /@media \(max-width: 620px\)[\s\S]*?\.eip7702RevokeFacts > div[\s\S]*?grid-template-columns 1fr[\s\S]*?\.eip7702RevokeFeeRow[\s\S]*?grid-template-columns 1fr auto[\s\S]*?> button[\s\S]*?width 100%/
  )
})

test('gives collectible buttons the shared visible keyboard focus treatment', () => {
  expect(inventoryStyle).toMatch(
    /\.inventoryCollectionItem[\s\S]*?appearance none[\s\S]*?&:focus-visible[\s\S]*?outline 2px solid var\(--wren-focus\)/
  )
  expect(inventoryStyle).toMatch(
    /\.inventoryDisplay[\s\S]*?display grid[\s\S]*?grid-template-rows minmax\(132px, 42%\)[\s\S]*?\.inventoryCollectionItems[\s\S]*?min-height 0[\s\S]*?overflow-y auto/
  )
})

test('lets every notification dialog scroll safely at compact heights', () => {
  expect(notifyStyle).toMatch(
    /\.notifyBoxWrap[\s\S]*?align-items flex-start[\s\S]*?overflow-y auto[\s\S]*?\.notifyBoxSlide[\s\S]*?margin auto/
  )
  expect(notifyStyle).toMatch(/\.notifyBox[\s\S]*?margin auto/)
})
