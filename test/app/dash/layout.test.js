import fs from 'fs'

const baseStyle = fs.readFileSync('resources/base.styl', 'utf8')
const buttonStyle = fs.readFileSync('resources/Components/Button/index.styl', 'utf8')
const commandStyle = fs.readFileSync('app/dash/Command/style/index.styl', 'utf8')
const earnStyle = fs.readFileSync('app/dash/Earn/style/index.styl', 'utf8')
const mainStyle = fs.readFileSync('app/dash/Main/style/index.styl', 'utf8')
const dashStyle = fs.readFileSync('app/dash/index.styl', 'utf8')

test('defines every shared dashboard typography role', () => {
  expect(baseStyle).toMatch(/--wren-type-label var\(--wren-type-caption\)/)
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
})

test('uses ruled Earn detail regions and the shared focus treatment', () => {
  expect(earnStyle).toMatch(
    /\.earnVariants, \.earnOwned, \.earnActionForm[\s\S]*?border-top 1px solid var\(--wren-ledger-rule\)[\s\S]*?border-radius 0[\s\S]*?background transparent[\s\S]*?box-shadow none/
  )
  expect(earnStyle).toMatch(
    /\.earnTabs button\.wrenControl:focus-visible,[\s\S]*?outline 2px solid var\(--wren-focus\)[\s\S]*?box-shadow none/
  )
  expect(earnStyle).toMatch(
    /button\.earnVariant\.wrenControl\.wrenControlSecondary[\s\S]*?flex-direction column/
  )
  expect(earnStyle).toMatch(
    /\.earnActions[\s\S]*?gap 0[\s\S]*?button\.wrenControl \+ button\.wrenControl[\s\S]*?border-left 1px solid var\(--wren-border-subtle\)[\s\S]*?button\.wrenControl\.active[\s\S]*?background var\(--wren-surface-active\)/
  )
})

test('keeps dashboard add actions compact and inactive network toggles neutral', () => {
  expect(dashStyle).toMatch(
    /\.dashFooter[\s\S]*?justify-content flex-end[\s\S]*?height 46px[\s\S]*?background transparent[\s\S]*?\.dashFooterButton[\s\S]*?width auto[\s\S]*?min-width 190px[\s\S]*?height 46px/
  )
  expect(dashStyle).toMatch(
    /\.network \.signerPermissionToggle[\s\S]*?width 42px[\s\S]*?height 24px[\s\S]*?border-radius 6px[\s\S]*?background var\(--wren-surface-inset\)[\s\S]*?\.network \.signerPermissionToggleOn[\s\S]*?background var\(--wren-surface-inset\)[\s\S]*?\.signerPermissionToggleSwitch[\s\S]*?background var\(--wren-success\)/
  )
})
