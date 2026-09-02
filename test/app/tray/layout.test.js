import fs from 'fs'

const baseStyle = fs.readFileSync('resources/base.styl', 'utf8')
const accountStyle = fs.readFileSync('app/tray/Account/style/account.styl', 'utf8')
const accountGrain = fs.readFileSync('resources/svg/wren-grain.svg', 'utf8')
const accountSource = fs.readFileSync('app/tray/Account/Account.js', 'utf8')
const accountSelectorStyle = fs.readFileSync('app/tray/AccountSelector/style/index.styl', 'utf8')
const balancesStyle = fs.readFileSync('app/tray/Account/Balances/style/index.styl', 'utf8')
const balanceSource = fs.readFileSync('app/tray/Account/Balances/Balance/index.js', 'utf8')
const balancesExpandedSource = fs.readFileSync('app/tray/Account/Balances/BalancesExpanded/index.js', 'utf8')
const inventoryStyle = fs.readFileSync('app/tray/Account/Inventory/style/index.styl', 'utf8')
const notifyStyle = fs.readFileSync('app/tray/Notify/style/index.styl', 'utf8')
const signerStyle = fs.readFileSync('app/tray/Account/Signer/style/index.styl', 'utf8')
const requestsStyle = fs.readFileSync('app/tray/Account/Requests/style/index.styl', 'utf8')
const walletCallsStyle = fs.readFileSync('app/tray/Account/Requests/style/wren-wallet-calls.styl', 'utf8')
const tokenSpendStyle = fs.readFileSync('resources/Components/EditTokenSpend/style/index.styl', 'utf8')
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
const footerSource = fs.readFileSync('app/tray/Footer/index.js', 'utf8')

test('keeps the compact wallet shell and its canvas on the same width contract', () => {
  expect(trayStyle).toMatch(/body::before[\s\S]*?width 620px/)
  expect(trayStyle).toMatch(/#panel[\s\S]*?width 620px/)
  expect(trayStyle).not.toMatch(/width 760px/)
})

test('keeps tray loaders subordinate to the shared reduced-motion override', () => {
  expect(baseStyle).toMatch(
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation-duration 1ms !important[\s\S]*?animation-iteration-count 1 !important/
  )
  expect(requestsStyle).not.toMatch(/animation[^\n]*!important/)
  expect(balancesStyle).not.toMatch(/animation[^\n]*!important/)
})

test('keeps approval units clear of the amount action and Wallet Calls nonce in its summary', () => {
  expect(tokenSpendStyle).toMatch(
    /input\.wrenInput[\s\S]*?padding 0 156px 0 var\(--wren-space-3\)[\s\S]*?\.wrenTokenApprovalAmountSymbol[\s\S]*?right 100px[\s\S]*?\.wrenTokenApprovalAmountAction,[\s\S]*?width 68px/
  )
  expect(walletCallsStyle).toMatch(
    /\.walletCallsAdjustSummary[\s\S]*?grid-template-columns minmax\(0, 1fr\) 96px auto[\s\S]*?\.walletCallsAdjustNonce[\s\S]*?\.walletCallsNonceInput\.wrenInput[\s\S]*?height 44px/
  )
  expect(walletCallsStyle).not.toContain('.walletCallsNonceSection')
})

test('keeps prepared deployment copy identities at a full control height', () => {
  expect(signingStyle).toMatch(
    /button\.transactionReviewDeploymentCopy[\s\S]*?display flex[\s\S]*?align-items center[\s\S]*?min-height 44px/
  )
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

test('keeps account collection spacing-led and balances on a flat ruled ledger', () => {
  expect(accountStyle).not.toMatch(/wren-(?:seam|rule)|wren-ledger-rule/)
  expect(balancesStyle).toMatch(
    /\.balancesExpandedLedger > \.cluster,[\s\S]*?border 0[\s\S]*?\.clusterValue[\s\S]*?border-bottom 1px solid var\(--wren-ledger-rule\)/
  )
  expect(accountStyle).toMatch(/\.clusterRow \+ \.clusterRow[\s\S]*?margin-top var\(--wren-space-2\)/)
})

test('keeps the account atmosphere static across startup and ordinary browsing only', () => {
  expect(baseStyle).toMatch(/--wren-bg-wallet-canvas #070907/)
  expect(accountStyle).toMatch(
    /#panel[\s\S]*?&:has\(\.accountSelector:not\(\.accountSelectorOpen\)\),[\s\S]*?&:has\(\.accountMain\),[\s\S]*?&:has\(\.accountView:not\(\.accountViewRequest\)\):not\(:has\(\.signerRequest\)\)[\s\S]*?background-color var\(--wren-bg-wallet-canvas\)[\s\S]*?background-image url\('\.\.\/\.\.\/resources\/svg\/wren-grain\.svg'\)[\s\S]*?background-repeat repeat, no-repeat, no-repeat, no-repeat[\s\S]*?background-size 144px 144px/
  )
  expect(accountStyle.match(/wren-grain\.svg/g)).toHaveLength(3)
  expect(accountStyle).toMatch(
    /\.workspace-edge-left #panel[\s\S]*?radial-gradient\(ellipse 94% 58% at 98% -8%[\s\S]*?radial-gradient\(ellipse 82% 54% at -2% 54%[\s\S]*?radial-gradient\(ellipse 72% 42% at 88% 104%/
  )
  expect(accountGrain).toMatch(
    /<feTurbulence type="fractalNoise"[\s\S]*?stitchTiles="stitch"[\s\S]*?<feColorMatrix type="saturate" values="0"[\s\S]*?<feComponentTransfer>[\s\S]*?<rect width="144" height="144" opacity="0\.11"/
  )
})

test('uses one bounded flat-row account list across startup and wallet switching', () => {
  expect(accountSelectorStyle).toMatch(
    /\.accountChooserPanel[\s\S]*?background transparent[\s\S]*?pointer-events auto/
  )
  expect(accountSelectorStyle).toMatch(
    /\.accountSelector \.accountDrawerScroll[\s\S]*?border 1px solid var\(--wren-border-default\)[\s\S]*?border-radius 10px[\s\S]*?background var\(--wren-surface-card\)/
  )
  expect(accountSelectorStyle).toMatch(
    /\.accountDrawerItem[\s\S]*?border-bottom 1px solid var\(--wren-ledger-rule\)[\s\S]*?background transparent[\s\S]*?&:last-child[\s\S]*?border-bottom 0/
  )
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
  const edgeOverride = accountStyle
    .split('.workspace-edge-left #panel')[1]
    .split('#panel:has(.accountMainPerch)')[0]
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
  expect(accountSelectorStyle).toMatch(
    /\.accountSelector:not\(\.accountSelectorOpen\)[\s\S]*?\.accountSelectorWelcome[\s\S]*?padding 16px 0 18px/
  )
  expect(accountSelectorStyle).toMatch(
    /\.panelFilterMain\.accountDrawerFilter[\s\S]*?input, input:hover, input:focus[\s\S]*?padding 0 42px 0 50px[\s\S]*?\.panelFilterIcon[\s\S]*?left 10px/
  )
  expect(trayShellStyle).toMatch(
    /\.panelMenu[\s\S]*?left 0[\s\S]*?right 0[\s\S]*?top 0[\s\S]*?height 64px[\s\S]*?\.panelMenuItemOpen[\s\S]*?right var\(--wren-space-5\)[\s\S]*?left auto/
  )
  expect(trayShellStyle).toMatch(
    /button\.panelWorkspaceToggle\.wrenControl\.wrenShellNav[\s\S]*?top 13px[\s\S]*?width 38px[\s\S]*?height 38px[\s\S]*?border 1px solid var\(--wren-border-default\)[\s\S]*?background var\(--wren-surface-card\)/
  )
})

test('keeps expanded balances as a plain ledger with crisp circular progress markers', () => {
  expect(balancesExpandedSource).not.toMatch(/ClusterBox/)
  expect(balancesExpandedSource).toMatch(/<Icon name='search' size=\{15\}/)
  expect(signingStyle).toMatch(
    /\.txLifecycleStepMarker[\s\S]*?width 8px[\s\S]*?height 8px[\s\S]*?box-sizing border-box[\s\S]*?border-radius 999px/
  )
})

test('keeps account modules free of decorative seams', () => {
  expect(accountStyle).toMatch(/\.accountModuleCard[\s\S]*?border-top 0/)
  expect(accountStyle).not.toMatch(/\.accountModule:not\(:first-child\)::before/)
  expect(accountSource).toMatch(/const ACCOUNT_MODULE_SECTION_GAP = 12/)
  expect(accountSource).toMatch(/requests: 106/)
  expect(accountSource).toMatch(/const getAccountModuleGap = \(\) => ACCOUNT_MODULE_SECTION_GAP/)
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

test('keeps activity on a ruled Perch ledger and exposes its expanded module', () => {
  expect(accountSource).toMatch(/import Activity(?:, \{[^}]+\})? from '\.\/Activity'/)
  expect(accountSource).toMatch(/activity: Activity/)
  expect(accountSource).toMatch(/crumb\.data\.title \|\|/)
  expect(accountSource).toMatch(
    /compactTop=\{\s*crumb\.data\.id === 'requests' \|\| crumb\.data\.id === 'activity' \|\| crumb\.data\.id === 'balances'\s*\}/
  )
  expect(activityStyle).toMatch(/\.activityList[\s\S]*?gap 0[\s\S]*?border 0[\s\S]*?background transparent/)
  expect(activityStyle).toMatch(
    /\.activityRow[\s\S]*?border-bottom 1px solid var\(--wren-border-subtle\)[\s\S]*?\.activityItem:last-child \.activityRow[\s\S]*?border-bottom 0/
  )
  expect(activityStyle).toMatch(/\.activityRow[\s\S]*?&:hover[\s\S]*?background var\(--wren-surface-hover\)/)
  expect(activityStyle).toMatch(/\.activityDetailSection[\s\S]*?background var\(--wren-surface-card\)/)
  expect(activityStyle).toMatch(
    /\.activityModuleExpanded[\s\S]*?\.activityList[\s\S]*?border 1px solid var\(--wren-border-default\)[\s\S]*?background var\(--wren-surface-card\)/
  )
  expect(activityStyle).toMatch(
    /\.activityModuleExpanded[\s\S]*?padding 0 var\(--wren-space-3\) var\(--wren-space-5\)/
  )
  expect(requestsStyle).toMatch(
    /\.requestGroupBlock[\s\S]*?border 1px solid var\(--wren-border-default\)[\s\S]*?background var\(--wren-surface-card\)/
  )
  expect(accountStyle).toMatch(
    /#panel:has\(\.accountSelector:not\(\.accountSelectorOpen\)\),[\s\S]*?#panel:has\(\.activityModuleExpanded\),[\s\S]*?#panel:has\(\.requestViewScroll\)/
  )
  expect(accountStyle).not.toMatch(/radial-gradient\(circle at/)
})

test('keeps reserved tray bands clean and gives startup one aligned account ledger', () => {
  expect(accountStyle).not.toMatch(/footerWrapActive|wren-(?:seam|rule)/)
  expect(accountSelectorStyle).toMatch(
    /\.accountSelector:not\(\.accountSelectorOpen\)[\s\S]*?\.accountSelectorScroll[\s\S]*?border 1px solid var\(--wren-border-default\)[\s\S]*?background var\(--wren-surface-card\)[\s\S]*?\.accountDrawerItem[\s\S]*?border-bottom 1px solid var\(--wren-ledger-rule\)/
  )
  expect(accountSelectorStyle).toMatch(
    /\.accountDrawerItem[\s\S]*?grid-template-columns 32px minmax\(0, 1fr\) 24px[\s\S]*?column-gap var\(--wren-space-2\)[\s\S]*?\.accountDrawerItemIcon[\s\S]*?justify-self center/
  )
  expect(revokeStyle).not.toMatch(/border-(?:top|bottom) 1px solid var\(--wren-ledger-rule\)/)
  expect(signingStyle).not.toMatch(/\.requestNoticeTransactionReview\n[\s\S]{0,100}?border-top/)
})

test('keeps warnings and balance siblings attached through spacing', () => {
  expect(balancesStyle).not.toMatch(/\.signerBalanceWarning[\s\S]{0,220}?border-top/)
  expect(balancesStyle).not.toMatch(/& \+ \.signerBalance[\s\S]{0,100}?border-top/)
  expect(balancesStyle).toMatch(/\.balanceFilter[\s\S]{0,120}?margin-bottom var\(--wren-space-2\)/)
  expect(balancesStyle).toMatch(
    /\.balancesExpandedLedger[\s\S]*?border 1px solid var\(--wren-border-default\)[\s\S]*?background linear-gradient/
  )
  expect(balancesStyle).toMatch(/\.signerBalanceButton[\s\S]*?height 44px[\s\S]*?min-height 44px/)
})

test('keeps gas evidence and network controls in one compact row', () => {
  expect(accountSource).not.toMatch(/accountHomeExplorer/)
  expect(accountStyle).toMatch(
    /\.chainMonitorCompactRow[\s\S]*?min-height 44px[\s\S]*?grid-template-columns auto minmax\(0, 1fr\) auto/
  )
  expect(accountStyle).toMatch(/\.chainMonitorSummary[\s\S]*?display flex[\s\S]*?\.sliceTileGasPrice/)
  expect(accountStyle).toMatch(/\.chainMonitorControls[\s\S]*?display flex[\s\S]*?gap 2px/)
  expect(accountStyle).toMatch(
    /button\.wrenControl[\s\S]*?width 44px[\s\S]*?height 44px[\s\S]*?button\.chainMonitorDisclosure[\s\S]*?width auto/
  )
  expect(accountStyle).toMatch(/\.accountHomeAddress[\s\S]*?min-height 44px/)
  expect(accountSource).toMatch(/wrenControlPrimary wrenControlLarge/)
  expect(accountStyle).not.toMatch(/\.chainMonitorGasEvidence|\.chainMonitorDivider/)
})

test('aligns balance artwork and copy with the account ledger rhythm', () => {
  expect(balancesStyle).toMatch(/\.signerBalanceCurrency[\s\S]*?left calc\(var\(--wren-space-4\) \+ 40px\)/)
  expect(balancesStyle).toMatch(/\.signerBalanceChain[\s\S]*?left calc\(var\(--wren-space-4\) \+ 40px\)/)
  expect(balancesStyle).toMatch(/\.signerBalancePrice[\s\S]*?left calc\(var\(--wren-space-4\) \+ 40px\)/)
  expect(balancesStyle).toMatch(
    /\.signerBalanceIcon[\s\S]*?top 19px[\s\S]*?left var\(--wren-space-4\)[\s\S]*?width 32px[\s\S]*?height 32px[\s\S]*?align-items center[\s\S]*?justify-content center/
  )
  expect(balanceSource).toMatch(/<AssetMark[\s\S]*?appearance='plain'[\s\S]*?className='balancesAssetMark'/)
  expect(balancesStyle).not.toMatch(/\.balancesAssetMark \.assetMarkGlyph/)
  expect(accountStyle).toMatch(
    /\.accountMainPerch \.signerBalance[\s\S]*?\.signerBalanceIcon[\s\S]*?width var\(--wren-account-ledger-mark-column\)[\s\S]*?height var\(--wren-account-ledger-mark-column\)[\s\S]*?overflow visible/
  )
  expect(accountStyle).toMatch(
    /\.balancesAssetMark[\s\S]*?--asset-mark-vector-size 20px[\s\S]*?\.ringIconFallback[\s\S]*?transform translate\(calc\(-50% \+ 3px\), -50%\)/
  )
})

test('keeps the account selector and privacy control on one optical axis', () => {
  expect(accountSelectorStyle).toMatch(
    /button\.accountSwitcherTrigger\.wrenControl\.wrenControlGhost[\s\S]*?height 44px[\s\S]*?padding 0[\s\S]*?grid-template-columns 32px minmax\(0, 1fr\)[\s\S]*?border 0[\s\S]*?background transparent[\s\S]*?box-shadow none/
  )
  expect(accountSelectorStyle).toMatch(/\.accountSwitcherBrand[\s\S]*?justify-self center/)
  expect(accountSelectorStyle).toMatch(/\.accountPrivacyToggle[\s\S]*?width 40px[\s\S]*?height 40px/)
})

test('keeps wallet summary and continuation actions clear of card edges', () => {
  expect(accountStyle).toMatch(/\.accountPortfolioValue[\s\S]*?font-weight 400/)
  expect(accountStyle).toMatch(
    /\.accountPortfolioSend[\s\S]*?right 16px[\s\S]*?bottom 24px[\s\S]*?width 136px/
  )
  expect(accountStyle).toMatch(
    /\.accountMainPerch \.balancesPreview[\s\S]*?\.signerBalanceTotal[\s\S]*?height 60px[\s\S]*?margin 0 8px 8px[\s\S]*?padding 8px 0/
  )
  expect(accountStyle).toMatch(
    /\.accountContinuationRow\.activityContinuation[\s\S]*?margin-top var\(--wren-space-2\)[\s\S]*?margin-bottom var\(--wren-space-2\)[\s\S]*?padding-left var\(--wren-space-5\)/
  )
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
    /\.accountView[\s\S]*?\.accountViewMenu[\s\S]*?height 64px[\s\S]*?\.accountViewMain[\s\S]*?top calc\(64px \+ var\(--wren-space-5\)\)/
  )
  expect(accountStyle).toMatch(/&:has\(\.requestViewScroll\)[\s\S]*?\.accountViewMain[\s\S]*?top 64px/)
})

test('separates request groups and the inbox toolbar with faint ledger rules', () => {
  expect(requestsStyle).toMatch(
    /\.requestGroupBlock\n {2}border-top 0[\s\S]*?& \+ \.requestGroupBlock\n {4}border-top 1px solid var\(--wren-ledger-rule\)/
  )
  expect(requestsStyle).toMatch(
    /\.requestQueueStatus[\s\S]*?border-bottom 1px solid var\(--wren-ledger-rule\)/
  )
})

test('keeps transaction review on one flat details ledger', () => {
  expect(accountSource).toMatch(/style=\{\{[\s\S]*?top: '0px'/)
  expect(accountSource).not.toMatch(/top: requestMode \|\| compactTop/)
  expect(accountSource).toMatch(/requestMode=\{true\}/)
  expect(accountStyle).toMatch(/\.accountView\n[\s\S]*?\.accountViewMenu\n {4}top 0/)
  expect(accountStyle).toMatch(
    /\.accountView[\s\S]*?&:has\(\.signerRequest\)[\s\S]*?\.accountViewMain[\s\S]*?top 64px/
  )
  expect(accountStyle).toMatch(
    /\.accountViewMeta[\s\S]*?display block[\s\S]*?color var\(--wren-text-tertiary\)[\s\S]*?text-align right[\s\S]*?text-overflow ellipsis/
  )
  const requestMetaStyle = accountStyle.split('.accountViewMeta')[1].split('.accountViewMain')[0]
  expect(requestMetaStyle).not.toMatch(/(?:^|\n)\s+(?:border|border-radius|background|padding) /)
  expect(signingStyle).toMatch(/\.approveTransaction\n {2}padding 0 var\(--wren-space-5\)/)
  expect(signingStyle).toMatch(
    /\.requestApproveTransaction,[\s\S]*?\.requestApproveLightweight\n[\s\S]*?padding var\(--wren-space-4\) var\(--wren-space-5\)/
  )
  expect(signingStyle).toMatch(/\.requestNoticeTransactionReview\n[\s\S]*?animation none/)
  expect(signingStyle).toMatch(/\.requestApproveTransaction\n\s{2}animation none/)
  expect(signingStyle).toMatch(
    /\._txActionButtonGood[\s\S]*?&:hover[\s\S]*?var\(--wren-accent-primary-hover\)/
  )
  expect(accountStyle).toMatch(
    /\.footerModule[\s\S]*?&:has\(\.requestNoticeApproval\),[\s\S]*?&:has\(\.requestNoticeTransactionReview\)[\s\S]*?transition none/
  )
  expect(accountStyle).toMatch(
    /#panel[\s\S]*?&:has\(\.requestNoticeApproval\) \.accountViewRequest,[\s\S]*?&:has\(\.requestNoticeTransactionReview\) \.accountViewRequest[\s\S]*?transition none/
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

test('keeps dapp access actions compact without changing transaction actions', () => {
  expect(footerSource).toMatch(
    /req\.type === 'access'[\s\S]*?approveLabel: 'Allow access'[\s\S]*?compactActions: true/
  )
  expect(signingStyle).toMatch(
    /\.requestApproveLightweight\.requestApproveCompact[\s\S]*?\.requestActionButtons[\s\S]*?width 240px[\s\S]*?grid-template-columns 104px 128px[\s\S]*?justify-self end/
  )
  expect(signingStyle).toMatch(
    /\.requestApproveLightweight\.requestApproveCompact[\s\S]*?\.requestDecline,[\s\S]*?\.requestSign[\s\S]*?width 100%[\s\S]*?height 44px/
  )
  expect(signingStyle).toMatch(
    /@media \(max-width: 560px\)[\s\S]*?\.requestApproveTransaction,[\s\S]*?\.requestApproveSignature,[\s\S]*?\.requestApproveLightweight/
  )
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

test('keeps recoverable request feedback from shifting its icon and actions', () => {
  expect(signingStyle).toMatch(
    /\.requestApproveRecoverable[\s\S]*?height auto[\s\S]*?\.requestActionContext[\s\S]*?align-items flex-start[\s\S]*?\.requestActionContextIcon[\s\S]*?margin-top 2px/
  )
  expect(signingStyle).toMatch(
    /\.requestApproveRecoverable[\s\S]*?\.requestActionError[\s\S]*?min-height 16px/
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
    /@media \(max-width: 600px\)[\s\S]*?\.eip7702RevokeFacts > div[\s\S]*?grid-template-columns 1fr[\s\S]*?\.eip7702RevokeFeeRow[\s\S]*?grid-template-columns 1fr auto[\s\S]*?> button[\s\S]*?width 100%/
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
