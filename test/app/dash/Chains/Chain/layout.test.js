import fs from 'fs'

const editorStyle = fs.readFileSync('app/dash/Chains/Chain/style/index.styl', 'utf8')
const toggleStyle = fs.readFileSync('resources/Components/Toggle/index.styl', 'utf8')

test('gives the form body sole overflow ownership while actions stay anchored', () => {
  expect(editorStyle).toMatch(/@media \(max-height: 760px\) and \(min-width: 561px\)/)
  expect(editorStyle).toMatch(/\.networkEditor\n[\s\S]*?height calc\(100vh - 64px\)[\s\S]*?overflow hidden/)
  expect(editorStyle).toMatch(/\.networkEditorBody\n[\s\S]*?overflow-y auto/)
  expect(editorStyle).toMatch(
    /\.localSettings:has\(\.networkEditor\) > \.localSettingsWrap[\s\S]*?overflow hidden/
  )
  expect(editorStyle).toMatch(
    /\.networkEditorHeader\n\s{4}min-height 60px\n\s{4}padding-top 10px\n\s{4}padding-bottom 8px/
  )
  expect(editorStyle).toMatch(/\.networkEditorBody\n[\s\S]*?padding-top 12px\n\s{4}padding-bottom 8px/)
  expect(editorStyle).toMatch(/\.networkEditorGrid\n\s{4}row-gap 14px/)
  expect(editorStyle).toMatch(/\.networkEditorToggleRow\n\s{4}margin-top 6px/)
  expect(editorStyle).toMatch(
    /\.networkEditorFooter\n\s{4}min-height 74px\n\s{4}padding-top 13px\n\s{4}padding-bottom 13px/
  )
  expect(editorStyle).toMatch(
    /\.networkEditorGrid\n\s{2}display grid\n\s{2}grid-template-columns minmax\(0, 2fr\) minmax\(0, 1fr\)/
  )
  expect(editorStyle).not.toMatch(/background-attachment local, scroll/)
  expect(editorStyle).toMatch(/\.networkEditor[\s\S]*?background transparent/)
})

test('anchors add and edit actions at the bottom while the form fits', () => {
  expect(editorStyle).toMatch(/\.networkEditor\n[\s\S]*?height calc\(100vh - 64px\)/)
  expect(editorStyle).toMatch(/\.networkEditorBody\n\s{2}position relative\n\s{2}flex 1 1 auto/)
  expect(editorStyle).toMatch(/\.localSettings:has\(\.networkEditor\) > \.localSettingsWrap\n\s{2}padding 0/)
  expect(editorStyle).toMatch(
    /\.networkEditorFooter[\s\S]*?border-top 1px solid var\(--wren-border-subtle\)[\s\S]*?background var\(--wren-surface-overlay\)/
  )
  expect(editorStyle).toMatch(
    /button\.networkEditorRemove\.wrenControl\n\s{2}height 44px\n\s{2}min-height 44px/
  )
})

test('keeps network editor copy readable and compact controls practically targetable', () => {
  expect(editorStyle).not.toMatch(/font-size (?:10|11)px/)
  expect(editorStyle).toMatch(/\.rpcEndpointMove\n[\s\S]*?height 44px/)
  expect(editorStyle).toMatch(/\.rpcEndpointMove\n[\s\S]*?width 88px[\s\S]*?repeat\(2, 44px\)/)
  expect(editorStyle).toMatch(/input\.networkEditorInput\n[\s\S]*?height 44px/)
  expect(editorStyle).toMatch(/input\.rpcEndpointInput\n[\s\S]*?height 44px/)
  expect(editorStyle).toMatch(/\.rpcEndpointRemove\n[\s\S]*?width 44px\n\s{2}height 44px/)
  expect(toggleStyle).toMatch(/\.wrenToggle\n[\s\S]*?width 44px\n\s{2}height 44px/)
  expect(toggleStyle).toMatch(/&::before\n[\s\S]*?width 44px\n\s{4}height 24px[\s\S]*?border-radius 2px/)
  expect(toggleStyle).toMatch(
    /\.wrenToggleThumb[\s\S]*?border-bottom 2px solid var\(--wren-border-strong\)[\s\S]*?border-radius 1px/
  )
  expect(toggleStyle).toMatch(
    /&:disabled[\s\S]*?&::before[\s\S]*?opacity \.55[\s\S]*?\.wrenToggleThumb[\s\S]*?opacity \.72/
  )
  expect(toggleStyle).toMatch(/&:disabled \.wrenToggleThumb\n\s{4}opacity 1/)
  expect(editorStyle).toMatch(/\.rpcEndpointAddRow[\s\S]*?button\n[\s\S]*?height 44px/)
  expect(editorStyle).toMatch(/\.rpcEndpointStatus[\s\S]*?font-family var\(--wren-font-ui\)/)
  expect(editorStyle).toMatch(/\.rpcEndpointState-standby\n\s{2}color var\(--wren-text-muted\)/)
})

test('uses spacing and boxed controls instead of decorative editor rules', () => {
  expect(editorStyle).not.toMatch(
    /wren-(?:seam|rule)|border-(?:top|bottom) 1px solid var\(--wren-ledger-rule\)/
  )
  expect(editorStyle).toMatch(/\.rpcEndpointRow[\s\S]*?min-height 70px/)
  expect(editorStyle).toMatch(/\.networkEditorFooter[\s\S]*?padding 26px var\(--wren-page-gutter\)/)
})
