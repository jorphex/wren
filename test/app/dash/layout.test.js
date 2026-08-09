import fs from 'fs'

const baseStyle = fs.readFileSync('resources/base.styl', 'utf8')
const buttonStyle = fs.readFileSync('resources/Components/Button/index.styl', 'utf8')
const commandStyle = fs.readFileSync('app/dash/Command/style/index.styl', 'utf8')
const earnStyle = fs.readFileSync('app/dash/Earn/style/index.styl', 'utf8')
const dashStyle = fs.readFileSync('app/dash/index.styl', 'utf8')

test('defines every shared dashboard typography role', () => {
  expect(baseStyle).toMatch(/--wren-type-label var\(--wren-type-caption\)/)
})

test('keeps disabled semantic controls visually neutral', () => {
  expect(buttonStyle).toMatch(
    /button\.wrenControl\.wrenControlPrimary:disabled,[\s\S]*?button\.wrenControl\.wrenControlDanger\[aria-disabled='true'\][\s\S]*?color var\(--wren-text-disabled\)[\s\S]*?background-color var\(--wren-surface-inset\)[\s\S]*?background-image none/
  )
})

test('contains long expanded-signer names inside the dashboard chrome', () => {
  expect(commandStyle).toMatch(/\.commandTitle[\s\S]*?min-width 0[\s\S]*?overflow hidden/)
  expect(commandStyle).toMatch(
    /> \.expandedSignerTitle[\s\S]*?max-width 100%[\s\S]*?\.signerName[\s\S]*?text-overflow ellipsis[\s\S]*?white-space nowrap/
  )
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
})

test('keeps dashboard add actions compact and inactive network toggles neutral', () => {
  expect(dashStyle).toMatch(
    /\.dashFooter[\s\S]*?justify-content flex-end[\s\S]*?height 46px[\s\S]*?background transparent[\s\S]*?\.dashFooterButton[\s\S]*?width auto[\s\S]*?min-width 190px[\s\S]*?height 46px/
  )
  expect(dashStyle).toMatch(
    /\.network \.signerPermissionToggle[\s\S]*?width 42px[\s\S]*?height 24px[\s\S]*?border-radius 6px[\s\S]*?background var\(--wren-surface-inset\)[\s\S]*?\.network \.signerPermissionToggleOn[\s\S]*?background var\(--wren-surface-inset\)[\s\S]*?\.signerPermissionToggleSwitch[\s\S]*?background var\(--wren-success\)/
  )
})
