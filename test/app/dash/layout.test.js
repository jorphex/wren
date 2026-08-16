import fs from 'fs'

const baseStyle = fs.readFileSync('resources/base.styl', 'utf8')
const buttonStyle = fs.readFileSync('resources/Components/Button/index.styl', 'utf8')
const commandStyle = fs.readFileSync('app/dash/Command/style/index.styl', 'utf8')
const earnStyle = fs.readFileSync('app/dash/Earn/style/index.styl', 'utf8')
const mainStyle = fs.readFileSync('app/dash/Main/style/index.styl', 'utf8')
const settingsStyle = fs.readFileSync('app/dash/Settings/style/index.styl', 'utf8')
const addressBookStyle = fs.readFileSync('app/dash/AddressBook/style/index.styl', 'utf8')
const dashStyle = fs.readFileSync('app/dash/index.styl', 'utf8')
const chainsStyle = fs.readFileSync('app/dash/Chains/style/index.styl', 'utf8')
const signerStyle = fs.readFileSync('app/dash/Signer/style/index.styl', 'utf8')
const accountAddStyle = fs.readFileSync('app/dash/Accounts/Add/style/index.styl', 'utf8')
const canvasGrain = fs.readFileSync('resources/svg/wren-grain.svg', 'utf8')

test('defines every shared dashboard typography role', () => {
  expect(baseStyle).toMatch(/--wren-type-label var\(--wren-type-caption\)/)
  expect(baseStyle).not.toMatch(/--wren-(?:seam|rule)-/)
})

test('continues the joined wallet canvas according to its dock edge', () => {
  expect(dashStyle).toMatch(
    /\.dash[\s\S]*?background-color var\(--wren-bg-canvas\)[\s\S]*?url\('\.\.\/\.\.\/resources\/svg\/wren-grain\.svg'\)[\s\S]*?radial-gradient\(ellipse 94% 58% at 98% -8%[\s\S]*?background-size 144px 144px/
  )
  expect(dashStyle).toMatch(
    /\.dash[\s\S]*?\.dashMain[\s\S]*?background transparent[\s\S]*?\.workspace-edge-left \.dash,[\s\S]*?\.workspace-overlay \.dash[\s\S]*?radial-gradient\(ellipse 94% 58% at 2% -8%[\s\S]*?radial-gradient\(ellipse 82% 54% at 102% 54%[\s\S]*?radial-gradient\(ellipse 72% 42% at 12% 104%/
  )
  expect(dashStyle).toMatch(/\.dashMain[\s\S]*?\.localSettings[\s\S]*?background transparent/)
  expect(dashStyle).toMatch(
    /\.workspace-edge-right \.dash[\s\S]*?border-top-right-radius 0[\s\S]*?border-bottom-right-radius 0/
  )
  expect(dashStyle).toMatch(
    /\.workspace-edge-left \.dash[\s\S]*?border-top-left-radius 0[\s\S]*?border-bottom-left-radius 0/
  )
  expect(canvasGrain).toMatch(/width="144" height="144"[\s\S]*?stitchTiles="stitch"/)
})

test('shows a narrow blocky scrollbar without drawing a track rule', () => {
  expect(dashStyle).toMatch(
    /::-webkit-scrollbar[\s\S]*?width 6px[\s\S]*?::-webkit-scrollbar-track[\s\S]*?background transparent[\s\S]*?::-webkit-scrollbar-thumb[\s\S]*?border 2px solid transparent[\s\S]*?border-radius 2px[\s\S]*?background-color var\(--wren-text-muted\)/
  )
  expect(dashStyle).toMatch(
    /::-webkit-scrollbar-track\n {2}background transparent\n\n::-webkit-scrollbar-thumb/
  )
  expect(dashStyle).toMatch(/\/\/ Wren dashboard shell[\s\S]*?\.dashMainScroll[\s\S]*?overflow-y auto/)
  expect(dashStyle).toMatch(
    /\/\/ Wren dashboard shell[\s\S]*?\.dashMainScroll[\s\S]*?scrollbar-gutter stable both-edges/
  )
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

test('keeps dashboard destination descriptions readable in two balanced columns', () => {
  expect(mainStyle).toMatch(/\.dashModuleList[\s\S]*?grid-template-columns minmax\(0, 1fr\)/)
  expect(mainStyle).toMatch(/\.dashModules[\s\S]*?grid-template-columns repeat\(2, minmax\(0, 1fr\)\)/)
  expect(mainStyle).toMatch(/button\.dashModule\.wrenControl[\s\S]*?min-height 72px[\s\S]*?height auto/)
  expect(mainStyle).toMatch(/\.dashModuleList[\s\S]*?gap var\(--wren-space-2\)/)
  expect(mainStyle).not.toMatch(/wren-(?:seam|rule)/)
})

test('groups chooser, settings, and networks with spacing instead of decorative rules', () => {
  for (const style of [dashStyle, settingsStyle, chainsStyle]) {
    expect(style).not.toMatch(/wren-(?:seam|rule)|border-(?:top|bottom) 1px solid var\(--wren-ledger-rule\)/)
  }
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

test('keeps account chooser and setup routes on the shared dashboard canvas', () => {
  expect(dashStyle).toMatch(
    /\.dash \.dashMain \.addAccounts\n {2}background transparent[\s\S]*?\.addAccounts\.addAccountsChooser/
  )
  expect(accountAddStyle).toMatch(
    /\/\/ Wren account setup surfaces[\s\S]*?\.addAccountItemWrap[\s\S]*?background transparent/
  )
})

test('keeps the Control Center Wren decorative, fixed beside the title, and absent at the narrow fallback', () => {
  expect(mainStyle).toMatch(
    /\.dashHomeHeader[\s\S]*?grid-template-columns minmax\(0, 1fr\) 96px[\s\S]*?align-items center[\s\S]*?\.dashHomeWren[\s\S]*?width 96px[\s\S]*?height 96px[\s\S]*?justify-self end[\s\S]*?pointer-events none/
  )
  expect(mainStyle).toMatch(
    /@media \(max-width: 560px\)[\s\S]*?\.dashHomeHeader[\s\S]*?grid-template-columns minmax\(0, 1fr\)[\s\S]*?\.dashHomeWren[\s\S]*?display none/
  )
})

test('uses separator-free Earn lists, spacing-led detail regions, and the shared focus treatment', () => {
  expect(earnStyle).toMatch(/\.earnPositionList, \.earnVaultList[\s\S]*?gap 0/)
  expect(earnStyle).not.toMatch(/\.earnVault \+ \.earnVault, \.earnPosition \+ \.earnPosition/)
  expect(earnStyle).toMatch(
    /\.earnVariants, \.earnOwned, \.earnActionForm[\s\S]*?margin-top var\(--wren-space-6\)[\s\S]*?border 0[\s\S]*?border-radius 0[\s\S]*?background transparent[\s\S]*?box-shadow none/
  )
  expect(earnStyle).toMatch(/\.earnApy[\s\S]*?strong[\s\S]*?color var\(--wren-accent-primary-hover\)/)
  expect(earnStyle).toMatch(
    /\.earnPositionsOverview[\s\S]*?padding 0 0 var\(--wren-space-5\)[\s\S]*?border-bottom 0/
  )
  expect(earnStyle).toMatch(
    /\.earnMetric[\s\S]*?padding var\(--wren-space-3\)[\s\S]*?border 0[\s\S]*?background transparent/
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
})

test('keeps the Trezor PIN submit action in the Wren control language', () => {
  expect(signerStyle).toMatch(
    /\.signerPinSubmit[\s\S]*?min-height 44px[\s\S]*?border-radius var\(--wren-radius-sm\)[\s\S]*?font-weight 550[\s\S]*?text-transform none[\s\S]*?&:disabled[\s\S]*?color var\(--wren-text-muted\)[\s\S]*?opacity 1/
  )
  expect(signerStyle).not.toMatch(/\.signerPinSubmit[\s\S]{0,180}?text-transform uppercase/)
})

test('renders page actions with their destination instead of delaying the footer', () => {
  expect(dashStyle).not.toContain('@keyframes showFooter')
  expect(dashStyle).not.toMatch(/\.dashFooter[\s\S]*?animation showFooter/)
})

test('keeps local interaction states stronger than the later shared ghost-control rules', () => {
  expect(settingsStyle).toMatch(
    /\.interfaceScaleOption[\s\S]*?&\.wrenControlGhost:hover:not\(:disabled\)[\s\S]*?background-color var\(--wren-surface-active\)[\s\S]*?box-shadow inset/
  )
  expect(addressBookStyle).toMatch(
    /button\.addressBookRemove\.wrenControl\.wrenControlGhost[\s\S]*?&:hover:not\(:disabled\)[\s\S]*?background var\(--wren-danger-soft\)[\s\S]*?color var\(--wren-danger\)/
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
