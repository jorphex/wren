import fs from 'fs'

const baseStyle = fs.readFileSync('resources/base.styl', 'utf8')
const accountStyle = fs.readFileSync('app/tray/Account/style/account.styl', 'utf8')
const accountGrain = fs.readFileSync('resources/svg/wren-grain.svg', 'utf8')
const accountSource = fs.readFileSync('app/tray/Account/Account.js', 'utf8')
const accountSelectorStyle = fs.readFileSync('app/tray/AccountSelector/style/index.styl', 'utf8')
const balancesStyle = fs.readFileSync('app/tray/Account/Balances/style/index.styl', 'utf8')
const inventoryStyle = fs.readFileSync('app/tray/Account/Inventory/style/index.styl', 'utf8')
const notifyStyle = fs.readFileSync('app/tray/Notify/style/index.styl', 'utf8')
const signerStyle = fs.readFileSync('app/tray/Account/Signer/style/index.styl', 'utf8')
const requestsStyle = fs.readFileSync('app/tray/Account/Requests/style/index.styl', 'utf8')
const walletCallsStyle = fs.readFileSync('app/tray/Account/Requests/style/wren-wallet-calls.styl', 'utf8')
const signingStyle = fs.readFileSync('app/tray/Account/Requests/style/wren-signing.styl', 'utf8')
const transactionEvidenceStyle = fs.readFileSync(
  'app/tray/Account/Requests/TransactionRequest/ViewData/style/index.styl',
  'utf8'
)
const transactionStyle = fs.readFileSync(
  'app/tray/Account/Requests/TransactionRequest/style/new.styl',
  'utf8'
)
const revokeStyle = fs.readFileSync('app/tray/Account/Requests/style/wren-eip7702-revoke.styl', 'utf8')
const activityStyle = fs.readFileSync('app/tray/Account/Activity/style/index.styl', 'utf8')
const trayStyle = fs.readFileSync('app/tray/index.styl', 'utf8')
const trayShellStyle = fs.readFileSync('app/tray/style/index.styl', 'utf8')

test('keeps the compact wallet shell and its canvas on the same width contract', () => {
  expect(trayStyle).toMatch(/body::before[\s\S]*?width 620px/)
  expect(trayStyle).toMatch(/#panel[\s\S]*?width 620px/)
  expect(trayStyle).not.toMatch(/width 760px/)
})

test('squares the canvas and panel corners only along an open workspace seam', () => {
  expect(trayStyle).toMatch(
    /\.workspace-open\.workspace-edge-right\n[\s\S]*?border-top-left-radius 0[\s\S]*?border-bottom-left-radius 0/
  )
  expect(trayStyle).toMatch(
    /\.workspace-open\.workspace-edge-left\n[\s\S]*?border-top-right-radius 0[\s\S]*?border-bottom-right-radius 0/
  )
  expect(trayStyle).toMatch(
    /\.workspace-open\.workspace-edge-right::before[\s\S]*?border-top-left-radius 0[\s\S]*?border-bottom-left-radius 0/
  )
  expect(trayStyle).toMatch(
    /\.workspace-open\.workspace-edge-left::before[\s\S]*?border-top-right-radius 0[\s\S]*?border-bottom-right-radius 0/
  )
  expect(trayStyle).toMatch(
    /\.workspace-open\.workspace-edge-right #panel[\s\S]*?border-top-left-radius 0[\s\S]*?border-bottom-left-radius 0/
  )
  expect(trayStyle).toMatch(
    /\.workspace-open\.workspace-edge-left #panel[\s\S]*?border-top-right-radius 0[\s\S]*?border-bottom-right-radius 0/
  )
})

test('shows a narrow blocky scrollbar without drawing a track rule', () => {
  expect(trayStyle).toMatch(
    /::-webkit-scrollbar[\s\S]*?width 6px[\s\S]*?::-webkit-scrollbar-track[\s\S]*?background transparent[\s\S]*?::-webkit-scrollbar-thumb[\s\S]*?border 2px solid transparent[\s\S]*?border-radius 2px[\s\S]*?background-color var\(--wren-text-muted\)/
  )
  expect(trayStyle).toMatch(
    /::-webkit-scrollbar-track\n {2}background transparent\n\n::-webkit-scrollbar-thumb/
  )
})

test('keeps account collection and balance interiors spacing-led', () => {
  expect(accountStyle).not.toMatch(/wren-(?:seam|rule)|wren-ledger-rule/)
  expect(balancesStyle).not.toMatch(/wren-(?:seam|rule)|wren-ledger-rule/)
  expect(accountStyle).toMatch(/\.clusterRow \+ \.clusterRow[\s\S]*?margin-top var\(--wren-space-2\)/)
})

test('keeps the account atmosphere static across startup and ordinary browsing only', () => {
  expect(baseStyle).toMatch(/--wren-bg-wallet-canvas #070907/)
  expect(accountStyle).toMatch(
    /#panel[\s\S]*?&:has\(\.accountSelector:not\(\.accountSelectorOpen\)\),[\s\S]*?&:has\(\.accountMain\),[\s\S]*?&:has\(\.accountView:not\(\.accountViewRequest\)\):not\(:has\(\.signerRequest\)\)[\s\S]*?background-color var\(--wren-bg-wallet-canvas\)[\s\S]*?background-image url\('\.\.\/\.\.\/resources\/svg\/wren-grain\.svg'\)[\s\S]*?background-repeat repeat, no-repeat, no-repeat, no-repeat[\s\S]*?background-size 144px 144px/
  )
  expect(accountStyle.match(/wren-grain\.svg/g)).toHaveLength(2)
  expect(accountStyle).toMatch(
    /\.workspace-edge-left #panel[\s\S]*?radial-gradient\(ellipse 94% 58% at 98% -8%[\s\S]*?radial-gradient\(ellipse 82% 54% at -2% 54%[\s\S]*?radial-gradient\(ellipse 72% 42% at 88% 104%/
  )
  expect(accountGrain).toMatch(
    /<feTurbulence type="fractalNoise"[\s\S]*?stitchTiles="stitch"[\s\S]*?<feColorMatrix type="saturate" values="0"[\s\S]*?<feComponentTransfer>[\s\S]*?<rect width="144" height="144" opacity="0\.11"/
  )
})

test('lets the selected-account chooser share the wallet canvas', () => {
  expect(accountSelectorStyle).toMatch(
    /\.accountChooserPanel[\s\S]*?background transparent[\s\S]*?pointer-events auto/
  )
  expect(accountSelectorStyle).toMatch(/\.accountDrawerItem[\s\S]*?background transparent/)
  expect(accountSelectorStyle).toMatch(
    /&\.accountDrawerItemSelected[\s\S]*?background var\(--wren-ledger-selected\)/
  )
  expect(accountStyle).toMatch(
    /#panel[\s\S]*?&:has\(\.accountSelectorOpen\[aria-modal='true'\]\) \.accountMain[\s\S]*?display none/
  )
  expect(accountStyle).toMatch(
    /#panel[\s\S]*?&:has\(\.accountView\) \.accountSelector\.accountSelectorOpen[\s\S]*?display none/
  )
})

test('keeps the account body geometry independent from the dashboard dock edge', () => {
  expect(accountStyle).toMatch(/\/\/ Wren account surface\n\.accountMain\n {2}top 88px/)
  expect(accountSelectorStyle).toMatch(/\.accountSelector\.accountSelectorOpen\n {2}top 6px/)
  const edgeOverride = accountStyle.split('.workspace-edge-left #panel')[1].split('.accountHomeHeader')[0]
  expect(edgeOverride).not.toMatch(/\n {2}\.account(?:Main|Selector)/)
})

test('keeps the home-to-requests gap compact without shifting the selector rail', () => {
  expect(accountStyle).toMatch(
    /\.accountHomeHeader[\s\S]*?padding 0 var\(--wren-space-5\) var\(--wren-space-3\)/
  )
  expect(accountSelectorStyle).toMatch(
    /\.accountSelectorScrollWrap[\s\S]*?padding 24px var\(--wren-space-5\) 48px/
  )
  expect(accountStyle).toMatch(/\.accountHomeAddress[\s\S]*?min-height 44px/)
  expect(accountStyle).toMatch(/\.accountHomeQrTrigger[\s\S]*?min-height 44px/)
})

test('keeps the QR disclosure opaque and gives it restrained material depth', () => {
  expect(accountStyle).toMatch(
    /\.accountAddressQrPopover[\s\S]*?background-color var\(--wren-bg-elevated\)[\s\S]*?background-image var\(--wren-control-texture-dark\)[\s\S]*?box-shadow var\(--wren-shadow-lg\), var\(--wren-shadow-inset\)/
  )
})

test('centers shared filter icons in the 44px field and anchors the startup control right', () => {
  expect(accountSelectorStyle).toMatch(
    /\.panelFilterIcon[\s\S]*?top 2px[\s\S]*?bottom 2px[\s\S]*?align-items center/
  )
  expect(accountSelectorStyle).toMatch(/\.panelFilterInput[\s\S]*?top 2px[\s\S]*?bottom 2px/)
  expect(trayShellStyle).toMatch(/\.panelMenuItemOpen[\s\S]*?right var\(--wren-space-2\)[\s\S]*?left auto/)
})

test('keeps account modules free of decorative seams', () => {
  expect(accountStyle).toMatch(/\.accountModuleCard[\s\S]*?border-top 0/)
  expect(accountStyle).not.toMatch(/\.accountModule:not\(:first-child\)::before/)
  expect(accountSource).toMatch(/const ACCOUNT_MODULE_ATTACHED_GAP = 4/)
  expect(accountSource).toMatch(/const ACCOUNT_MODULE_SECTION_GAP = 16/)
  expect(accountSource).toMatch(
    /previousId === 'requests' && id === 'chains' \? ACCOUNT_MODULE_ATTACHED_GAP : ACCOUNT_MODULE_SECTION_GAP/
  )
  expect(accountSource).toMatch(
    /const gap = height > 0 && previousVisibleModuleId \? getAccountModuleGap\(previousVisibleModuleId, id\) : 0/
  )
  expect(accountSource).toMatch(/if \(height > 0\) previousVisibleModuleId = id/)
  expect(accountStyle).toMatch(/\.requestsPreview\n {2}height 48px\n {2}border 0\n {2}border-radius 0/)
  expect(signerStyle).toMatch(
    /\.signerPreviewSummary[\s\S]*?display flex[\s\S]*?justify-content space-between/
  )
  expect(accountStyle).toMatch(
    /\.accountLedgerModule[\s\S]*?\.accountLedgerRow[\s\S]*?min-height 52px[\s\S]*?\.accountLedgerLabel[\s\S]*?flex 0 0 112px/
  )
})

test('keeps activity grouped by spacing and exposes its expanded module', () => {
  expect(accountSource).toMatch(/import Activity from '\.\/Activity'/)
  expect(accountSource).toMatch(/activity: Activity/)
  expect(accountSource).toMatch(/crumb\.data\.title \|\|/)
  expect(accountSource).toMatch(
    /compactTop=\{\s*crumb\.data\.id === 'requests' \|\| crumb\.data\.id === 'activity' \|\| crumb\.data\.id === 'balances'\s*\}/
  )
  expect(activityStyle).toMatch(/\.activityList[\s\S]*?gap var\(--wren-space-1\)/)
  expect(activityStyle).not.toMatch(/border-(?:top|bottom)|wren-(?:seam|rule)|wren-ledger-rule/)
  expect(accountStyle).not.toMatch(/radial-gradient\(circle at/)
})

test('keeps reserved tray bands and revocation evidence free of decorative horizontal rules', () => {
  expect(accountStyle).not.toMatch(/footerWrapActive|wren-(?:seam|rule)/)
  expect(accountSelectorStyle).not.toMatch(/wren-(?:seam|rule)|wren-ledger-rule/)
  expect(revokeStyle).not.toMatch(/border-(?:top|bottom) 1px solid var\(--wren-ledger-rule\)/)
  expect(signingStyle).not.toMatch(/\.requestNoticeTransactionReview\n[\s\S]{0,100}?border-top/)
})

test('keeps warnings and balance siblings attached through spacing', () => {
  expect(balancesStyle).not.toMatch(/\.signerBalanceWarning[\s\S]{0,220}?border-top/)
  expect(balancesStyle).not.toMatch(/& \+ \.signerBalance[\s\S]{0,100}?border-top/)
  expect(balancesStyle).toMatch(/\.balanceFilter\n {2}margin-bottom var\(--wren-space-2\)/)
})

test('keeps network switching, chain explorer, and gas evidence as distinct controls', () => {
  expect(accountSource).not.toMatch(/accountHomeExplorer/)
  expect(accountStyle).toMatch(
    /\.chainMonitorRow[\s\S]*?grid-template-columns minmax\(0, 1fr\) auto 1px auto auto/
  )
  expect(accountStyle).toMatch(
    /\.chainMonitorSwitchButton,[\s\S]*?\.chainMonitorExplorer[\s\S]*?min-height 44px/
  )
  expect(accountStyle).toMatch(/\.chainMonitorControls[\s\S]*?display flex[\s\S]*?gap var\(--wren-space-1\)/)
  expect(accountStyle).toMatch(
    /\.chainMonitorGasEvidence[\s\S]*?justify-content flex-end[\s\S]*?\.chainMonitorDisclosure[\s\S]*?min-height 44px/
  )
  expect(accountStyle).toMatch(/\.accountHomeAddress[\s\S]*?min-height 44px/)
  expect(accountSource).toMatch(/wrenControlPrimary wrenControlLarge/)
  expect(accountStyle).toMatch(
    /\.chainMonitorIdentity[\s\S]*?padding-left var\(--wren-space-3\)[\s\S]*?\.chainMonitorMark[\s\S]*?width 24px[\s\S]*?height 24px/
  )
  expect(accountStyle).toMatch(
    /\.chainMonitorDivider[\s\S]*?height 24px[\s\S]*?@media \(max-width: 540px\)[\s\S]*?grid-template-columns minmax\(0, 1fr\) auto[\s\S]*?\.chainMonitorDivider[\s\S]*?display none/
  )
})

test('aligns balance artwork and copy with the account ledger rhythm', () => {
  expect(balancesStyle).toMatch(/\.signerBalanceCurrency[\s\S]*?left calc\(var\(--wren-space-4\) \+ 40px\)/)
  expect(balancesStyle).toMatch(/\.signerBalanceChain[\s\S]*?left calc\(var\(--wren-space-4\) \+ 40px\)/)
  expect(balancesStyle).toMatch(/\.signerBalancePrice[\s\S]*?left calc\(var\(--wren-space-4\) \+ 40px\)/)
  expect(balancesStyle).toMatch(
    /\.signerBalanceIcon[\s\S]*?top 19px[\s\S]*?left var\(--wren-space-4\)[\s\S]*?width 32px[\s\S]*?height 32px[\s\S]*?align-items center[\s\S]*?justify-content center/
  )
  expect(balancesStyle).toMatch(
    /\.balancesAssetMark \.assetMarkGlyph[\s\S]*?border-color transparent[\s\S]*?background transparent[\s\S]*?box-shadow none/
  )
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

test('keeps ordinary account subviews below the shell header', () => {
  expect(accountStyle).toMatch(
    /\.accountView[\s\S]*?\.accountViewMain[\s\S]*?top calc\(52px \+ var\(--wren-space-3\) \+ var\(--wren-space-5\)\)/
  )
  expect(accountStyle).toMatch(
    /&:has\(\.requestViewScroll\)[\s\S]*?\.accountViewMain[\s\S]*?top calc\(52px \+ var\(--wren-space-3\)\)/
  )
})

test('separates request groups without ruling the inbox toolbar', () => {
  expect(requestsStyle).toMatch(
    /\.requestGroupBlock\n {2}border-top 0[\s\S]*?& \+ \.requestGroupBlock\n {4}border-top 1px solid var\(--wren-ledger-rule\)/
  )
  expect(requestsStyle).toMatch(
    /\.requestQueueStatus[\s\S]*?border-bottom 0/
  )
})

test('keeps transaction review on one flat details ledger', () => {
  expect(accountSource).toMatch(/style=\{\{[\s\S]*?top: '10px'/)
  expect(accountSource).not.toMatch(/top: requestMode \|\| compactTop/)
  expect(accountSource).toMatch(/requestMode=\{true\}/)
  expect(accountStyle).toMatch(
    /\.accountView[\s\S]*?&:has\(\.signerRequest\)[\s\S]*?\.accountViewMain[\s\S]*?top 52px/
  )
  expect(accountStyle).toMatch(
    /\.accountViewMeta[\s\S]*?display block[\s\S]*?color var\(--wren-text-tertiary\)[\s\S]*?text-align right[\s\S]*?text-overflow ellipsis/
  )
  const requestMetaStyle = accountStyle.split('.accountViewMeta')[1].split('.accountViewMain')[0]
  expect(requestMetaStyle).not.toMatch(/(?:^|\n)\s+(?:border|border-radius|background|padding) /)
  expect(signingStyle).toMatch(
    /\.approveTransaction\n {2}padding 0 var\(--wren-space-5\) var\(--wren-space-4\)/
  )
  expect(signingStyle).toMatch(
    /\.requestApproveTransaction,[\s\S]*?\.requestApproveLightweight\n[\s\S]*?padding var\(--wren-space-4\) var\(--wren-space-5\)/
  )
  expect(signingStyle).toMatch(
    /\.transactionReviewSectionTitle[\s\S]*?padding var\(--wren-space-4\) 0 var\(--wren-space-1\)/
  )
  expect(signingStyle).toMatch(/\._txLabel[\s\S]*?padding var\(--wren-space-4\) 0 var\(--wren-space-2\)/)
  expect(signingStyle).toMatch(/\._txMainTag[\s\S]*?padding var\(--wren-space-3\) 0/)
  expect(signingStyle).toMatch(
    /\.requestItem,[\s\S]*?border-radius 0[\s\S]*?background transparent[\s\S]*?\.transactionReviewSectionTitle/
  )
  expect(signingStyle).toMatch(
    /\.transactionReviewRecipient,[\s\S]*?\.transactionReviewFee,[\s\S]*?\.transactionReviewNonce[\s\S]*?margin 0/
  )
  expect(signingStyle).toMatch(
    /\.transactionReviewFeeRow,[\s\S]*?\.transactionReviewNonceRow[\s\S]*?grid-template-columns 96px minmax\(0, 1fr\) auto/
  )
  expect(signingStyle).toMatch(
    /\.transactionReviewRecipient[\s\S]*?\.clusterRow:first-child \.clusterValue[\s\S]*?grid-template-columns 96px minmax\(0, 1fr\)/
  )
  expect(signingStyle).toMatch(
    /\.transactionReviewAddress[\s\S]*?grid-template-columns 96px minmax\(0, 1fr\)/
  )
  expect(signingStyle).toMatch(/\.transactionReviewCopyFeedback[\s\S]*?position absolute[\s\S]*?right 0/)
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
  expect(transactionEvidenceStyle).toMatch(/&\.transactionEvidenceGroupDisclosure\n {6}padding-top 0/)
})

test('keeps compact transfer summaries inline and revocation review on one focused canvas', () => {
  expect(transactionStyle).toMatch(
    /\.txDescriptionSummaryStandalone[\s\S]*?\._txDescriptionTransfer[\s\S]*?display flex[\s\S]*?align-items baseline[\s\S]*?gap var\(--wren-space-2\)/
  )
  expect(revokeStyle).toMatch(/\.eip7702RevokeRequest[\s\S]*?background var\(--wren-bg-canvas\)/)
  expect(revokeStyle).not.toMatch(
    /@media \(max-width: 620px\)[\s\S]*?\.eip7702RevokeDocument[\s\S]*?padding-(?:right|left) var\(--wren-space-3\)/
  )
})

test('keeps signing evidence readable and operable when the shell is scaled', () => {
  expect(signingStyle).toMatch(/\.txLifecycleStep[\s\S]*?font-size 12px/)
  expect(signingStyle).toMatch(
    /\.txLifecycleAction,[\s\S]*?\.txLifecycleDetails button,[\s\S]*?\.txLifecycleCancelRequest[\s\S]*?min-height 44px[\s\S]*?height 44px/
  )
  expect(signingStyle).toMatch(
    /@media \(max-width: 560px\)[\s\S]*?\.approveTransaction \.transactionReviewMain[\s\S]*?\._txDescription[\s\S]*?grid-template-columns minmax\(0, 1fr\)[\s\S]*?\.transactionReviewSummaryStatus[\s\S]*?width 100%[\s\S]*?max-width none/
  )
  expect(signingStyle).toMatch(
    /\.requestSign:disabled \.requestSignButton,[\s\S]*?\.requestSign:disabled \.requestSignButton:hover[\s\S]*?color var\(--wren-text-inverse\)[\s\S]*?background var\(--wren-control-texture-light\), var\(--wren-accent-primary\)/
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
