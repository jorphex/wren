import fs from 'fs'

const editorStyle = fs.readFileSync('app/dash/Chains/Chain/style/index.styl', 'utf8')

test('keeps the short network editor body scrollable above its fixed actions', () => {
  expect(editorStyle).toMatch(/@media \(max-height: 760px\) and \(min-width: 561px\)/)
  expect(editorStyle).toMatch(
    /\.networkEditor\n\s{4}height calc\(100vh - 88px\)\n\s{4}min-height 0\n\s{4}overflow hidden/
  )
  expect(editorStyle).toMatch(/\.networkEditorBody\n\s{4}overflow-x hidden\n\s{4}overflow-y auto/)
  expect(editorStyle).toMatch(
    /\.networkEditorGrid\n\s{2}display grid\n\s{2}grid-template-columns minmax\(0, 2fr\) minmax\(0, 1fr\)/
  )
  expect(editorStyle).toMatch(/background-attachment local, scroll/)
})

test('keeps network editor copy readable and compact controls practically targetable', () => {
  expect(editorStyle).not.toMatch(/font-size (?:10|11)px/)
  expect(editorStyle).toMatch(/\.rpcEndpointMove\n[\s\S]*?height 44px/)
  expect(editorStyle).toMatch(/\.rpcEndpointRemove\n[\s\S]*?width 44px\n\s{2}height 44px/)
  expect(editorStyle).toMatch(/\.networkEditorToggle\n[\s\S]*?width 44px\n\s{2}height 44px/)
  expect(editorStyle).toMatch(/\.rpcEndpointAddRow[\s\S]*?button\n[\s\S]*?height 44px/)
})
