import fs from 'fs'

const earnStyle = fs.readFileSync('app/dash/Earn/style/index.styl', 'utf8')

test('keeps the pre-action risk disclosure visibly distinct from quiet footer copy', () => {
  expect(earnStyle).toMatch(
    /\.earnRiskDisclosure[\s\S]*?color var\(--wren-text-secondary\)[\s\S]*?background var\(--wren-warning-soft\)/
  )
})
