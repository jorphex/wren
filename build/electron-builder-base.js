const config = {
  appId: 'io.github.jorphex.wren',
  productName: 'Wren',
  npmRebuild: false,
  files: [
    'compiled',
    'bundle',
    '!compiled/main/dev',
    '!node_modules/**/*.map',
    '!node_modules/**/*.d.{ts,cts,mts}',
    '!node_modules/@ledgerhq/{domain-service,evm-tools}/src/__tests__/**/*'
  ]
}

module.exports = config
