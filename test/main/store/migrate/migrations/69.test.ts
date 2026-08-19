import migrations from '../../../../../main/store/migrate'

const state = (name: string) => ({
  main: {
    _version: 68,
    networks: {
      ethereum: {
        1: { id: 1, name },
        10: { id: 10, name: 'Optimism Mainnet' }
      }
    }
  }
})

test.each(['Mainnet', 'Ethereum Mainnet'])('renames the legacy Ethereum label %s', (name) => {
  const migrated = migrations.apply(state(name))

  expect(migrated.main._version).toBe(69)
  expect(migrated.main.networks.ethereum[1].name).toBe('Ethereum')
  expect(migrated.main.networks.ethereum[10].name).toBe('Optimism Mainnet')
})

test('preserves a custom Ethereum label', () => {
  const migrated = migrations.apply(state('Production'))

  expect(migrated.main.networks.ethereum[1].name).toBe('Production')
})
