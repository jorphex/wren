import fs from 'fs'

const editorStyle = fs.readFileSync('app/dash/Chains/Chain/style/index.styl', 'utf8')
const toggleStyle = fs.readFileSync('resources/Components/Toggle/index.styl', 'utf8')

test('keeps the short network editor body scrollable above its fixed actions', () => {
  expect(editorStyle).toMatch(/@media \(max-height: 760px\) and \(min-width: 561px\)/)
  expect(editorStyle).toMatch(
    /\.networkEditor\n\s{4}height calc\(100vh - 88px\)\n\s{4}min-height 0\n\s{4}overflow hidden/
  )
  expect(editorStyle).toMatch(/\.networkEditorBody\n\s{4}overflow-x hidden\n\s{4}overflow-y auto/)
  expect(editorStyle).toMatch(
    /\.networkEditorGrid\n\s{2}display grid\n\s{2}grid-template-columns minmax\(0, 2fr\) minmax\(0, 1fr\)/
  )
  expect(editorStyle).not.toMatch(/background-attachment local, scroll/)
  expect(editorStyle).toMatch(/\.networkEditor[\s\S]*?background transparent/)
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
})

test('uses spacing and boxed controls instead of decorative editor rules', () => {
  expect(editorStyle).not.toMatch(
    /wren-(?:seam|rule)|border-(?:top|bottom) 1px solid var\(--wren-ledger-rule\)/
  )
  expect(editorStyle).toMatch(/\.rpcEndpointRow[\s\S]*?min-height 56px/)
  expect(editorStyle).toMatch(/\.networkEditorFooter[\s\S]*?padding 26px 24px/)
})
