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
