import fs from 'fs'

const baseStyle = fs.readFileSync('resources/base.styl', 'utf8')
const buttonStyle = fs.readFileSync('resources/Components/Button/index.styl', 'utf8')
const commandStyle = fs.readFileSync('app/dash/Command/style/index.styl', 'utf8')
const earnStyle = fs.readFileSync('app/dash/Earn/style/index.styl', 'utf8')
const mainStyle = fs.readFileSync('app/dash/Main/style/index.styl', 'utf8')
const settingsStyle = fs.readFileSync('app/dash/Settings/style/index.styl', 'utf8')
const addressBookStyle = fs.readFileSync('app/dash/AddressBook/style/index.styl', 'utf8')
const tokenStyle = fs.readFileSync('app/dash/Tokens/CustomTokens/style/index.styl', 'utf8')
const chainEditorStyle = fs.readFileSync('app/dash/Chains/Chain/style/index.styl', 'utf8')
const sendStyle = fs.readFileSync('app/dash/Send/style/index.styl', 'utf8')
const dashStyle = fs.readFileSync('app/dash/index.styl', 'utf8')
const chainsStyle = fs.readFileSync('app/dash/Chains/style/index.styl', 'utf8')
const signerStyle = fs.readFileSync('app/dash/Signer/style/index.styl', 'utf8')
const signerStatusStyle = fs.readFileSync('app/dash/Signer/SignerStatus/style/index.styl', 'utf8')
const accountAddStyle = fs.readFileSync('app/dash/Accounts/Add/style/index.styl', 'utf8')
const accountStyle = fs.readFileSync('app/tray/Account/style/account.styl', 'utf8')
const badgeStyle = fs.readFileSync('app/tray/Badge/style/index.styl', 'utf8')
const txApprovalStyle = fs.readFileSync('app/tray/Footer/RequestCommand/TxApproval/style/index.styl', 'utf8')
const inspectorStyle = fs.readFileSync('app/dash/Inspector/style/index.styl', 'utf8')
const deploymentStyle = fs.readFileSync('app/dash/Deployment/style/index.styl', 'utf8')
const contractVerificationStyle = fs.readFileSync('app/dash/ContractVerification/style/index.styl', 'utf8')
const contractsStyle = fs.readFileSync('app/dash/Contracts/style/index.styl', 'utf8')
const dappsStyle = fs.readFileSync('app/dash/Dapps/style/index.styl', 'utf8')
const dappStyle = fs.readFileSync('app/dapp/index.styl', 'utf8')
const dropdownStyle = fs.readFileSync('resources/Components/Dropdown/index.styl', 'utf8')
const inputStyle = fs.readFileSync('resources/Components/Input/index.styl', 'utf8')
const canvasGrain = fs.readFileSync('resources/svg/wren-grain.svg', 'utf8')

test('defines every shared dashboard typography role', () => {
  expect(baseStyle).toMatch(/--wren-type-label var\(--wren-type-caption\)/)
  expect(baseStyle).toMatch(/--wren-page-gutter var\(--wren-space-5\)/)
  expect(baseStyle).toMatch(/@media \(max-width: 540px\)[\s\S]*?--wren-page-gutter var\(--wren-space-3\)/)
  expect(baseStyle).not.toMatch(/--wren-(?:seam|rule)-/)
})

test('keeps embedded-app transitions opaque and lets reduced motion override loaders', () => {
  expect(dappStyle).toMatch(/body[\s\S]*?background var\(--wren-bg-canvas\)/)
  expect(dappStyle).toMatch(/\.splash[\s\S]*?background var\(--wren-bg-canvas\)/)
  expect(dappStyle).toMatch(/\.main[\s\S]*?background var\(--wren-bg-canvas\)/)
  expect(dappStyle).not.toMatch(/animation[^\n]*!important/)
  expect(mainStyle).not.toMatch(/animation[^\n]*!important/)
})

test('uses one page gutter across comparable dashboard destinations', () => {
  expect(mainStyle).toMatch(
    /\.localSettingsWrap[\s\S]*?padding var\(--wren-space-5\) var\(--wren-page-gutter\)/
  )
  expect(settingsStyle).toMatch(/\.localSettingsWrap[\s\S]*?var\(--wren-page-gutter\)/)
  expect(addressBookStyle).toMatch(/\.addressBook, \.addressBookEditor[\s\S]*?var\(--wren-page-gutter\)/)
  expect(chainEditorStyle).toMatch(/\.networkEditorHeader[\s\S]*?padding 15px var\(--wren-page-gutter\) 12px/)
  expect(contractsStyle).toMatch(/\.contracts[\s\S]*?padding 0 var\(--wren-page-gutter\)/)
  expect(inspectorStyle).toMatch(/\.inspector[\s\S]*?padding 0 var\(--wren-page-gutter\)/)
  expect(dappsStyle).toMatch(/\.connectedApps[\s\S]*?padding 0 var\(--wren-page-gutter\)/)
})

test('supplies dark native-menu hints and Wren selection roles to both select families', () => {
  for (const style of [inputStyle, dropdownStyle]) {
    expect(style).toMatch(/color-scheme dark/)
    expect(style).toMatch(/option:checked[\s\S]*?var\(--wren-accent-primary\)/)
    expect(style).toMatch(/option:hover,[\s\S]*?option:focus[\s\S]*?var\(--wren-surface-active\)/)
  }
})

test('continues the joined wallet canvas according to its dock edge', () => {
  expect(baseStyle).toMatch(
    /--wren-window-atmosphere-wallet url\('\.\/svg\/wren-grain\.svg'\)[\s\S]*?--wren-window-atmosphere-workspace-right url\('\.\/svg\/wren-grain\.svg'\)[\s\S]*?--wren-window-atmosphere-workspace-left url\('\.\/svg\/wren-grain\.svg'\)/
  )
  expect(dashStyle).toMatch(
    /\.dash[\s\S]*?--wren-window-mode-image var\(--wren-window-atmosphere-workspace-right\)[\s\S]*?--wren-window-mode-size var\(--wren-window-atmosphere-workspace-size\)[\s\S]*?background-color var\(--wren-window-mode-canvas\)[\s\S]*?background-image var\(--wren-window-mode-image\)/
  )
  expect(dashStyle).toMatch(
    /\.dash[\s\S]*?\.dashMain[\s\S]*?background transparent[\s\S]*?\.workspace-edge-left \.dash,[\s\S]*?\.workspace-overlay \.dash[\s\S]*?--wren-window-mode-image var\(--wren-window-atmosphere-workspace-left\)/
  )
  expect(dashStyle).toMatch(
    /\.dash:has\(\.dashHomePerch\),[\s\S]*?\.dash:has\(\.sendComposer\)[\s\S]*?--wren-window-mode-image var\(--wren-window-atmosphere-wallet\)[\s\S]*?--wren-window-mode-shadow var\(--wren-window-atmosphere-wallet-shadow\)/
  )
  expect(dashStyle).not.toMatch(/url\('\.\.\/\.\.\/resources\/svg\/wren-grain\.svg'\)/)
  expect(dashStyle).toMatch(/\.dashMain[\s\S]*?\.localSettings[\s\S]*?background transparent/)
  expect(inspectorStyle).toMatch(
    /\.inspectorHeader[\s\S]*?border-bottom 1px solid var\(--wren-border-subtle\)[\s\S]*?background transparent/
  )
  expect(dashStyle).toMatch(
    /\.workspace-edge-right \.dash[\s\S]*?border-top-right-radius 0[\s\S]*?border-bottom-right-radius 0/
  )
  expect(dashStyle).toMatch(
    /\.workspace-edge-left \.dash[\s\S]*?border-top-left-radius 0[\s\S]*?border-bottom-left-radius 0/
  )
  expect(canvasGrain).toMatch(/width="144" height="144"[\s\S]*?stitchTiles="stitch"/)
})

test('uses a default cursor for dashboard copy while preserving editable text behavior', () => {
  expect(dashStyle).toMatch(
    /\.dash[\s\S]*?cursor default[\s\S]*?user-select none[\s\S]*?input,[\s\S]*?textarea,[\s\S]*?\[contenteditable='true'\][\s\S]*?cursor text[\s\S]*?user-select text/
  )
})

test('shows a narrow blocky scrollbar without drawing a track rule', () => {
  expect(dashStyle).toMatch(
    /::-webkit-scrollbar[\s\S]*?width 6px[\s\S]*?::-webkit-scrollbar-track[\s\S]*?background transparent[\s\S]*?::-webkit-scrollbar-thumb[\s\S]*?border 2px solid transparent[\s\S]*?border-radius 2px[\s\S]*?background-color var\(--wren-text-muted\)/
  )
  expect(dashStyle).toMatch(
    /::-webkit-scrollbar-track\n {2}background transparent\n\n::-webkit-scrollbar-thumb/
  )
  expect(dashStyle).toMatch(/\/\/ Wren dashboard shell[\s\S]*?\.dashMainScroll[\s\S]*?overflow-y auto/)
  expect(dashStyle).toMatch(/\.dashMainScroll[\s\S]*?scrollbar-gutter stable/)
  expect(dashStyle).not.toMatch(/scrollbar-gutter stable both-edges/)
})

test('keeps route-entry motion out of dashboard scroll geometry', () => {
  expect(dashStyle).toMatch(/\.dashMainScroll[\s\S]*?> \.cardShow[\s\S]*?animation none/)
  expect(dashStyle).not.toMatch(/dashPageShow|animation-name dashPageShow/)
  expect(dappsStyle).toMatch(/\.connectedApps\n {2}display flow-root/)
})

test('keeps disabled semantic controls visually neutral', () => {
  expect(buttonStyle).toMatch(
    /button\.wrenControl\.wrenControlPrimary:disabled,[\s\S]*?button\.wrenControl\.wrenControlDanger\[aria-disabled='true'\][\s\S]*?color var\(--wren-text-disabled\)[\s\S]*?background-color var\(--wren-surface-inset\)[\s\S]*?background-image none/
  )
})

test('keeps shell navigation flat at rest and tactile on interaction', () => {
  expect(buttonStyle).toMatch(
    /button\.wrenControl\.wrenShellNav[\s\S]*?border-color transparent[\s\S]*?background-color transparent[\s\S]*?box-shadow none[\s\S]*?&:hover:not\(:disabled\)[\s\S]*?background-color var\(--wren-surface-hover\)/
  )
})

test('contains long expanded-signer names inside the dashboard chrome', () => {
  expect(commandStyle).toMatch(/\.commandTitle[\s\S]*?min-width 0[\s\S]*?overflow hidden/)
  expect(commandStyle).toMatch(
    /> \.expandedSignerTitle[\s\S]*?max-width 100%[\s\S]*?\.signerName[\s\S]*?text-overflow ellipsis[\s\S]*?white-space nowrap/
  )
})

test('uses the reference single-column push-button navigation geometry', () => {
  expect(mainStyle).toMatch(/\.dashModules[\s\S]*?flex-direction column[\s\S]*?gap 8px/)
  expect(mainStyle).toMatch(
    /button\.dashModule\.wrenControl[\s\S]*?grid-template-columns 30px minmax\(0, 1fr\) auto[\s\S]*?height 50px[\s\S]*?padding 0 15px[\s\S]*?border-radius 10px/
  )
  expect(mainStyle).toMatch(/\.dashModuleDescription[\s\S]*?width 1px[\s\S]*?clip rect\(0 0 0 0\)/)
  expect(mainStyle).not.toMatch(/wren-(?:seam|rule)/)
})

test('uses contained account ledgers while keeping settings and networks spacing-led', () => {
  for (const style of [settingsStyle, chainsStyle]) {
    expect(style).not.toMatch(/wren-(?:seam|rule)|border-(?:top|bottom) 1px solid var\(--wren-ledger-rule\)/)
  }
  expect(dashStyle).toMatch(
    /\.accountTypeGroup[\s\S]*?border 1px solid rgba\(150, 182, 150, \.16\)[\s\S]*?\.accountTypeGroupTitle[\s\S]*?border-bottom 1px solid var\(--wren-ledger-rule\)/
  )
  expect(dashStyle).toMatch(
    /\.accountTypeGroup \+ \.accountTypeGroup[\s\S]*?margin-top var\(--wren-space-5\)/
  )
  expect(settingsStyle).toMatch(
    /\.wrenSettingsSection \+ \.wrenSettingsSection[\s\S]*?margin-top var\(--wren-space-5\)/
  )
  expect(settingsStyle).toMatch(/\.recoverySettings[\s\S]*?gap var\(--wren-space-2\)/)
  expect(settingsStyle).toMatch(/\.recoveryPanel[\s\S]*?border-radius 2px/)
  expect(chainsStyle).toMatch(/\.network \+ \.network[\s\S]*?margin-top var\(--wren-space-2\)/)
  expect(chainsStyle).toMatch(/\.networkBreak[\s\S]*?margin-top var\(--wren-space-5\)/)
})

test('keeps network editors on the shared wallet canvas', () => {
  expect(chainEditorStyle).toMatch(/\.networkEditor[\s\S]*?background transparent/)
  expect(chainEditorStyle).not.toMatch(/\.networkEditor[\s\S]{0,260}?background var\(--wren-bg-canvas\)/)
  expect(chainEditorStyle).not.toMatch(/\.networkEditorBody[\s\S]{0,260}?background-image/)
})

test('keeps contact and token list entrances separator-free and contacts compact', () => {
  expect(addressBookStyle).toMatch(/\.addressBookRow[\s\S]*?min-height 82px/)
  expect(addressBookStyle).toMatch(
    /\.addressBookAddAction[\s\S]*?justify-content flex-end[\s\S]*?min-width 132px/
  )
  expect(addressBookStyle).not.toMatch(/\.addressBookList[\s\S]{0,140}?border-top/)
  expect(tokenStyle).not.toMatch(/\.customTokensList[\s\S]{0,140}?border-top/)
})

test('wraps RPC warning prose at word boundaries while containing technical tokens', () => {
  expect(txApprovalStyle).toMatch(
    /\.approveTransactionWarningBody[\s\S]*?overflow-wrap anywhere[\s\S]*?word-break normal/
  )
  expect(txApprovalStyle).not.toContain('word-break break-all')
})

test('uses whole-surface selection feedback without directional side accents', () => {
  expect(sendStyle).not.toMatch(/inset\s+\d+px\s+0\s+0/)
  expect(sendStyle).toMatch(
    /\.sendSweepAssets[\s\S]*?> label[\s\S]*?border 0[\s\S]*?border-radius 0[\s\S]*?&\.sendSweepAssetSelected[\s\S]*?background var\(--wren-ledger-selected\)[\s\S]*?box-shadow none/
  )
  expect(sendStyle).toMatch(
    /&\.sendAssetOptionSelected[\s\S]*?background var\(--wren-ledger-selected\)[\s\S]*?box-shadow var\(--wren-shadow-inset\)/
  )
})

test('aligns Send picker search content with the shared contact search inset', () => {
  expect(sendStyle).toMatch(/\.sendPickerSearch[\s\S]*?gap 10px[\s\S]*?padding 0 var\(--wren-space-3\)/)
  expect(addressBookStyle).toMatch(
    /\.addressBookSearch[\s\S]*?gap var\(--wren-space-2\)[\s\S]*?padding 0 var\(--wren-space-3\)/
  )
})

test('wraps resolved Send recipient addresses without clipping or ellipsis', () => {
  expect(sendStyle).toMatch(
    /\.sendRecipientFeedback[\s\S]*?overflow visible[\s\S]*?text-overflow clip[\s\S]*?white-space normal/
  )
  expect(sendStyle).toMatch(
    /\.sendRecipientResolved[\s\S]*?code[\s\S]*?overflow-wrap anywhere[\s\S]*?word-break break-all/
  )
})

test('keeps the Send composer and sticky action shelf on one canvas', () => {
  expect(sendStyle).toMatch(/\.sendComposer,[\s\S]*?background transparent/)
  expect(sendStyle).toMatch(/\.sendActionShelf[\s\S]{0,360}?background transparent/)
  expect(sendStyle).not.toMatch(/\.sendActionShelf[\s\S]{0,360}?background (?:rgba\(|var\()/)
  expect(sendStyle).not.toMatch(/\.sendActionShelf[\s\S]{0,400}?backdrop-filter/)
})

test('matches update dialogs to the account QR surface tokens', () => {
  for (const style of [accountStyle, badgeStyle]) {
    expect(style).toMatch(/border-radius var\(--wren-radius-md\)/)
    expect(style).toMatch(/background-color var\(--wren-bg-elevated\)/)
    expect(style).toMatch(/background-image var\(--wren-control-texture-dark\)/)
    expect(style).toMatch(/box-shadow var\(--wren-shadow-lg\), var\(--wren-shadow-inset\)/)
  }
})

test('keeps account chooser and setup routes on the shared dashboard canvas', () => {
  expect(dashStyle).toMatch(
    /\.dash \.dashMain \.addAccounts\n {2}background transparent[\s\S]*?\.addAccounts\.addAccountsChooser/
  )
  expect(accountAddStyle).toMatch(
    /\/\/ Wren account setup surfaces[\s\S]*?\.addAccountItemWrap[\s\S]*?background transparent/
  )
})

test('matches the compact Control identity chrome and omits the superseded large bird header', () => {
  expect(commandStyle).toMatch(
    /\.command\.commandHome[\s\S]*?height 64px[\s\S]*?gap 11px[\s\S]*?border-bottom 1px solid rgba\(150, 182, 150, \.10\)/
  )
  expect(commandStyle).toMatch(/\.commandHomeMark[\s\S]*?width 26px[\s\S]*?height 26px/)
  expect(commandStyle).toMatch(
    /\.commandHomeIdentity[\s\S]*?height 26px[\s\S]*?align-items center[\s\S]*?strong[\s\S]*?line-height 18px/
  )
  expect(commandStyle).toMatch(
    /\.commandHomeClose[\s\S]*?width 40px[\s\S]*?height 40px[\s\S]*?min-width 40px[\s\S]*?min-height 40px/
  )
  expect(mainStyle).not.toMatch(/\.dashHomeHeader|\.dashHomeWren/)
})

test('uses separator-free Earn lists, spacing-led detail regions, and the shared focus treatment', () => {
  expect(earnStyle).toMatch(/\.earnPositionList, \.earnVaultList[\s\S]*?gap 0/)
  expect(earnStyle).not.toMatch(/\.earnVault \+ \.earnVault, \.earnPosition \+ \.earnPosition/)
  expect(earnStyle).toMatch(
    /\.earnVariants, \.earnOwned, \.earnActionForm[\s\S]*?border 0[\s\S]*?border-radius 0[\s\S]*?background transparent[\s\S]*?box-shadow none/
  )
  expect(earnStyle).toMatch(
    /\.earnDetailsHero[\s\S]*?margin-bottom var\(--wren-space-2\)[\s\S]*?padding-bottom var\(--wren-space-3\)/
  )
  expect(earnStyle).toMatch(/\.earnDetailsMetrics[\s\S]*?margin 0/)
  expect(earnStyle).toMatch(
    /\.earnVariants\n {2}margin-top var\(--wren-space-2\)[\s\S]*?padding-top var\(--wren-space-2\)/
  )
  expect(earnStyle).toMatch(
    /\.earnProductNote\.earnCooldownNotice[\s\S]*?margin var\(--wren-space-3\) var\(--wren-space-2\)/
  )
  expect(earnStyle).toMatch(/\.earnApy[\s\S]*?strong[\s\S]*?color var\(--wren-text-primary\)/)
  expect(earnStyle).toMatch(
    /\.earnPositionsOverview[\s\S]*?padding 0 0 var\(--wren-space-5\)[\s\S]*?border-bottom 0/
  )
  expect(earnStyle).toMatch(
    /\.earnMetric[\s\S]*?padding var\(--wren-space-2\) var\(--wren-space-3\)[\s\S]*?border 0[\s\S]*?background transparent/
  )
  expect(earnStyle).toMatch(
    /\.earnTabs button\.wrenControl:focus-visible,[\s\S]*?outline 2px solid var\(--wren-focus\)[\s\S]*?box-shadow none/
  )
  expect(earnStyle).toMatch(
    /button\.earnVariant\.wrenControl\.wrenControlSecondary[\s\S]*?flex-direction column/
  )
  expect(earnStyle).toMatch(
    /\.earnActions[\s\S]*?gap var\(--wren-space-1\)[\s\S]*?padding var\(--wren-space-1\)[\s\S]*?button\.wrenControl[\s\S]*?border-radius var\(--wren-radius-sm\)[\s\S]*?button\.wrenControl\.active[\s\S]*?background var\(--wren-surface-active\)/
  )
  expect(earnStyle).toMatch(/@keyframes earnSkeletonPulse/)
  expect(earnStyle).toMatch(/\.earnPositionSkeleton[\s\S]*?pointer-events none[\s\S]*?transition none/)
  expect(earnStyle).toMatch(
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.earnSkeleton\n\s{4}animation none/
  )
})

test('keeps dashboard add actions compact and inactive network toggles neutral', () => {
  expect(dashStyle).toMatch(
    /\.dashFooter[\s\S]*?justify-content flex-end[\s\S]*?height 46px[\s\S]*?background transparent[\s\S]*?\.dashFooterButton[\s\S]*?width auto[\s\S]*?min-width 190px[\s\S]*?height 46px/
  )
  expect(dashStyle).toMatch(
    /\.network \.signerPermissionToggle[\s\S]*?width 44px[\s\S]*?height 44px[\s\S]*?&::before[\s\S]*?height 24px[\s\S]*?border-radius 2px[\s\S]*?\.signerPermissionToggleSwitch[\s\S]*?border-bottom 2px solid var\(--wren-border-strong\)[\s\S]*?border-radius 1px[\s\S]*?\.network \.signerPermissionToggleOn[\s\S]*?background var\(--wren-success-soft\)[\s\S]*?\.signerPermissionToggleSwitch[\s\S]*?background var\(--wren-success\)[\s\S]*?transform translateX\(20px\)/
  )
  expect(chainsStyle).toMatch(/\.discordInvite[\s\S]*?min-height 44px/)
})

test('keeps watch and signer identities on the same account-list axis', () => {
  expect(dashStyle).toMatch(
    /\.watchAccount[\s\S]*?padding 0 var\(--wren-space-2\)[\s\S]*?\.watchAccountIcon[\s\S]*?width 38px[\s\S]*?height 38px[\s\S]*?border 0[\s\S]*?color var\(--wren-accent-primary-hover\)[\s\S]*?background transparent/
  )
  expect(signerStyle).toMatch(
    /\.signersList \.signer[\s\S]*?min-height 72px[\s\S]*?padding 0 var\(--wren-space-2\)[\s\S]*?grid-template-columns minmax\(0, 1fr\) 14px[\s\S]*?\.signerDetails[\s\S]*?grid-template-columns 38px minmax\(0, 1fr\)[\s\S]*?gap var\(--wren-space-3\)[\s\S]*?\.signerIcon[\s\S]*?border 0[\s\S]*?color var\(--wren-accent-primary-hover\)[\s\S]*?background transparent/
  )
  expect(signerStyle).toMatch(/\.hardwareSignerPromptMark[\s\S]*?border 0[\s\S]*?background transparent/)
  expect(signerStyle).not.toMatch(/\.signerIconHardware[\s\S]{0,100}?transform/)
  expect(signerStyle).toMatch(/\.signersList \.signer[\s\S]*?border-bottom 0/)
  expect(signerStyle).not.toMatch(/\.signersList \.signer:last-child[\s\S]{0,120}?border-bottom/)
})

test('keeps utility alignment, support disclosure, and transaction facts inside established axes', () => {
  expect(mainStyle).toMatch(
    /\.dashHomeCard[\s\S]*?padding 16px[\s\S]*?border-radius 10px[\s\S]*?\.dashCompanionBrowserActions[\s\S]*?grid-template-columns repeat\(2, minmax\(0, 1fr\)\)/
  )
  expect(mainStyle).toMatch(/\.dashSupportWrenPreview[\s\S]*?left 0[\s\S]*?&::after[\s\S]*?left 28px/)
  expect(sendStyle).toMatch(/\.sendSweepChain[\s\S]*?\.dropdown\.wrenInput/)
  expect(inputStyle).toMatch(/select\.wrenInput[\s\S]*?option:checked[\s\S]*?var\(--wren-accent-primary\)/)
  expect(accountStyle).toMatch(/\.accountHomeRename[\s\S]*?max-width 100%[\s\S]*?min-width 0/)
  expect(fs.readFileSync('resources/Components/Monitor/style/index.styl', 'utf8')).not.toMatch(
    /\.gasDetails[\s\S]{0,220}?border-(?:top|left)/
  )
})

test('keeps the Trezor PIN submit action in the Wren control language', () => {
  expect(signerStyle).toMatch(
    /\.signerPinSubmit[\s\S]*?min-height 44px[\s\S]*?border-radius var\(--wren-radius-sm\)[\s\S]*?font-weight 550[\s\S]*?text-transform none[\s\S]*?&:disabled[\s\S]*?color var\(--wren-text-muted\)[\s\S]*?opacity 1/
  )
  expect(signerStyle).not.toMatch(/\.signerPinSubmit[\s\S]{0,180}?text-transform uppercase/)
})

test('leaves signer unlock action visuals to the shared Wren control', () => {
  expect(signerStatusStyle).toMatch(
    /\.signerUnlockSubmit\n {6}grid-column 2\n {6}grid-row 2\n {6}min-width 132px\n {6}margin 0/
  )
  expect(signerStatusStyle).not.toMatch(
    /\.signerUnlockSubmit(?::[^\n]+)?[\s\S]{0,220}?(?:background|border-radius|box-shadow|height|font-size|text-transform|opacity) /
  )
  expect(signerStatusStyle).not.toMatch(
    /\.signerUnlockInput\n {4}(?:position|height|border|outline|background|box-shadow|font-size|border-radius)/
  )
})

test('keeps the remaining review surfaces on established flat primitives', () => {
  expect(mainStyle).toMatch(
    /\.dashSupportActions\n {2}display grid\n {2}grid-template-columns repeat\(4, minmax\(0, 1fr\)\)[\s\S]*?button\.requestFeatureButton\.wrenControl[\s\S]*?height 48px[\s\S]*?border-radius 9px/
  )
  expect(txApprovalStyle).toMatch(
    /\.approveTransactionWarningBody[\s\S]*?display grid[\s\S]*?grid-template-rows auto auto 44px/
  )
  expect(inspectorStyle).toMatch(
    /\.inspectorInputPanel,[\s\S]*?border 0[\s\S]*?background transparent[\s\S]*?box-shadow none/
  )
  expect(inspectorStyle).toMatch(/\.inspectorEvidenceRow[\s\S]*?border 0[\s\S]*?dd[\s\S]*?border 0/)
  expect(inspectorStyle).not.toMatch(/\.inspectorWarnings[\s\S]{0,260}?border-left/)
})

test('keeps contract deployment on the flat wallet canvas and shared control primitives', () => {
  const deploymentCanvasStyle = deploymentStyle.split('.deploymentAbandonDialog')[0]
  expect(deploymentStyle).toMatch(
    /\.deploymentForm[\s\S]*?display flex[\s\S]*?\.deploymentEvidence[\s\S]*?dl[\s\S]*?border 0/
  )
  expect(deploymentStyle).toMatch(/\.deploymentEvidenceRow[\s\S]*?display grid[\s\S]*?border 0/)
  expect(deploymentStyle).toMatch(
    /\.deploymentActionShelf[\s\S]*?position sticky[\s\S]*?bottom 0[\s\S]*?justify-content flex-end/
  )
  expect(deploymentStyle).toMatch(
    /\.deploymentActionShelf[\s\S]*?background var\(--wren-bg-canvas\)[\s\S]*?pointer-events none[\s\S]*?button[\s\S]*?pointer-events auto/
  )
  expect(deploymentStyle).not.toMatch(/\.deploymentActionShelf[\s\S]{0,360}?background transparent/)
  expect(deploymentStyle).not.toMatch(
    /\.deploymentActionShelf[\s\S]{0,420}?background linear-gradient\(180deg, transparent, var\(--wren-bg-wallet-canvas\)/
  )
  expect(deploymentStyle).toMatch(/@media \(max-width: 540px\)[\s\S]*?grid-template-columns 1fr/)
  expect(deploymentStyle).toMatch(/\.deploymentFieldError[\s\S]*?&:empty[\s\S]*?display none/)
  expect(deploymentCanvasStyle).not.toMatch(/border-left|border-right|border-radius|box-shadow/)
})

test('uses one flat Contracts workspace with the established Send-style peer switch', () => {
  expect(contractsStyle).toMatch(
    /\.contracts[\s\S]*?overflow-x clip[\s\S]*?\.contractsModeSwitch\.sendModeSwitch[\s\S]*?margin 0 0 var\(--wren-space-3\)/
  )
  expect(contractsStyle).toMatch(/\.contractsPanel\[hidden\][\s\S]*?display none/)
  expect(contractsStyle).toMatch(/\.contractsPanel[\s\S]*?padding 0 2px/)
  expect(contractsStyle).toMatch(
    /> \.deployment \.deploymentActionShelf,[\s\S]*?margin-right 0[\s\S]*?padding-right 0/
  )
  expect(contractsStyle).not.toMatch(/border-left|border-right|box-shadow|linear-gradient/)
})

test('keeps Send modes quietly segmented and every editable value visible at rest', () => {
  const perchComposerStyle = sendStyle.slice(sendStyle.indexOf('// Perch composer:'))

  expect(perchComposerStyle).toMatch(
    /\.sendModeSwitch[\s\S]*?gap 4px[\s\S]*?border 1px solid var\(--wren-border-default\)[\s\S]*?background var\(--wren-surface-inset\)/
  )
  expect(perchComposerStyle).not.toMatch(/\.sendModeSwitch[\s\S]{0,900}?&::after/)
  expect(perchComposerStyle).toMatch(
    /\.sendInputWrap[\s\S]*?padding 0 6px 0 12px[\s\S]*?border-color var\(--wren-border-default\)[\s\S]*?background-color var\(--wren-surface-inset\)/
  )
  expect(perchComposerStyle).toMatch(
    /&\.wrenInputGroupError[\s\S]*?border-color var\(--wren-danger\)[\s\S]*?background-color var\(--wren-danger-soft\)/
  )
  expect(perchComposerStyle).toMatch(
    /&\.sendSweepAssetSelected[\s\S]*?background var\(--wren-ledger-selected\)[\s\S]*?box-shadow none/
  )
  expect(sendStyle).toMatch(/\.sendRecipientInput[\s\S]*?font-weight 200 !important/)
  expect(sendStyle).toMatch(/\.sendAmountInput[\s\S]*?font-weight 200 !important/)
  expect(sendStyle).toMatch(
    /\.sendSweepAssets[\s\S]*?grid-template-columns 20px 32px minmax\(0, 1fr\) minmax\(72px, auto\)[\s\S]*?grid-template-rows 18px 16px[\s\S]*?align-content center[\s\S]*?column-gap 12px[\s\S]*?row-gap 2px/
  )
  expect(sendStyle).toMatch(
    /\.sendSweepHeader[\s\S]*?display flex[\s\S]*?align-items center[\s\S]*?justify-content space-between/
  )
  expect(sendStyle).toMatch(
    /button\.sendSweepSelectAll\.wrenControl[\s\S]*?font-weight 430[\s\S]*?line-height 18px/
  )
  expect(sendStyle).toMatch(/\.sendComposerSweep[\s\S]*?\.sendSweepHeader[\s\S]*?padding 10px 16px/)
  expect(sendStyle).toMatch(
    /\.sendSweepAssetBalance[\s\S]*?align-self baseline[\s\S]*?justify-self end[\s\S]*?font-weight 200[\s\S]*?text-align right/
  )
})

test('keeps direct verification disclosure distinct from constructor helper copy', () => {
  expect(contractVerificationStyle).toMatch(
    /\.contractVerificationDirect p\.contractVerificationNotice[\s\S]*?margin-top var\(--wren-space-3\)[\s\S]*?color var\(--wren-text-secondary\)[\s\S]*?font-size var\(--wren-type-small\)[\s\S]*?line-height 19px/
  )
  expect(contractVerificationStyle).toMatch(
    /\.contractVerificationResultActions button\.wrenControl[\s\S]*?min-height 44px/
  )
})

test('keeps hardware prompts opaque while giving their scrim and surface restrained depth', () => {
  expect(signerStyle).toMatch(
    /\.hardwareSignerPromptOverlay[\s\S]*?background rgba\(4, 6, 4, \.78\)[\s\S]*?backdrop-filter blur\(5px\)/
  )
  expect(signerStyle).toMatch(
    /\.hardwareSignerPromptSurface\.expandedSigner[\s\S]*?background-color rgba\(13, 18, 16, \.94\)[\s\S]*?background-image var\(--wren-control-texture-dark\), radial-gradient[\s\S]*?box-shadow var\(--wren-shadow-lg\), var\(--wren-shadow-inset\)[\s\S]*?animation cardShow/
  )
})

test('renders page actions with their destination instead of delaying the footer', () => {
  expect(dashStyle).not.toContain('@keyframes showFooter')
  expect(dashStyle).not.toMatch(/\.dashFooter[\s\S]*?animation showFooter/)
})

test('keeps generated secrets in a stable single-frame viewport', () => {
  expect(accountAddStyle).toMatch(
    /&\.generatedWalletSetup[\s\S]*?\.addAccountItemOptionSetup\n {6}transform none !important\n {6}transition none[\s\S]*?\.addAccountItemOptionSetupFrames\n {8}position relative\n {8}width 100%[\s\S]*?\.addAccountItemOptionSetupFrame\n {10}display none\n {10}width 100%\n {10}transition none[\s\S]*?&\[aria-hidden='false'\]\n {12}display flex/
  )
})

test('keeps local interaction states stronger than the later shared ghost-control rules', () => {
  expect(settingsStyle).toMatch(
    /\.interfaceScaleOption[\s\S]*?&\.wrenControlGhost:hover:not\(:disabled\)[\s\S]*?background-color var\(--wren-surface-active\)[\s\S]*?box-shadow inset/
  )
  expect(settingsStyle).toMatch(
    /\.interfaceScaleOptions[\s\S]*?background rgba\(8, 12, 10, \.34\)[\s\S]*?\.interfaceScaleOption[\s\S]*?&\[aria-pressed='true'\],[\s\S]*?background var\(--wren-bg-elevated\)[\s\S]*?box-shadow var\(--wren-shadow-sm\)/
  )
  expect(addressBookStyle).toMatch(
    /button\.addressBookRemove\.wrenControl\.wrenControlGhost[\s\S]*?&:hover:not\(:disabled\)[\s\S]*?background var\(--wren-danger-soft\)[\s\S]*?color var\(--wren-danger\)/
  )
})

test('keeps the corrected Control ledgers compact, hoverable, and aligned', () => {
  expect(chainsStyle).toMatch(
    /\.network \.signerTop:has\(\.networkDetailsTrigger:hover\)[\s\S]*?background var\(--wren-ledger-hover\)/
  )
  expect(dappsStyle).toMatch(
    /\.dash \.dashMain \.connectedAppsPerch[\s\S]*?\.originTitle[\s\S]*?align-items center[\s\S]*?min-height 44px[\s\S]*?font-family var\(--wren-font-ui\)[\s\S]*?text-transform none[\s\S]*?\.originTitleIcon[\s\S]*?height 44px[\s\S]*?align-items center[\s\S]*?\.sliceOrigin[\s\S]*?min-height 52px/
  )
  expect(settingsStyle).toMatch(
    /\.contractVerificationCredentialIdentity[\s\S]*?justify-content space-between[\s\S]*?\.contractVerificationCredentialControls[\s\S]*?flex-direction column[\s\S]*?\.contractVerificationCredentialActions[\s\S]*?width 100%/
  )
  expect(settingsStyle).toMatch(
    /\.appInfo[\s\S]*?display grid[\s\S]*?min-height 44px[\s\S]*?grid-template-columns minmax\(0, 1fr\) auto auto auto/
  )
})

test('keeps delegation recovery spacing-led and responsive', () => {
  expect(dashStyle).toMatch(
    /\.delegationRevocation[\s\S]*?padding var\(--wren-space-4\) var\(--wren-space-2\)[\s\S]*?background transparent/
  )
  expect(dashStyle).not.toMatch(/\.delegationRevocation[\s\S]{0,260}?border-(?:top|bottom)/)
  expect(dashStyle).toMatch(/\.delegationRevocationSelectors[\s\S]*?select[\s\S]*?min-height 44px/)
  expect(dashStyle).toMatch(
    /\.delegationRevocationEligible[\s\S]*?> button\.wrenControl\.wrenControlPrimary[\s\S]*?height 44px[\s\S]*?min-height 44px/
  )
  expect(dashStyle).toMatch(
    /@media \(max-width: 540px\)[\s\S]*?\.delegationRevocationSelectors[\s\S]*?grid-template-columns 1fr[\s\S]*?\.delegationRevocationEligible[\s\S]*?flex-direction column/
  )
})
