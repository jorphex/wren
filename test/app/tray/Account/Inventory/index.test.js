import { InventoryExpanded } from '../../../../../app/tray/Account/Inventory/InventoryExpanded'
import { Inventory as InventoryCollection } from '../../../../../app/tray/Account/Inventory/InventoryCollection'
import { InventoryPreview } from '../../../../../app/tray/Account/Inventory/InventoryPreview'
import link from '../../../../../resources/link'
import { render, screen } from '../../../../componentSetup'

jest.mock('../../../../../resources/link', () => ({ send: jest.fn() }))

const account = 'account-1'
const collectionId = 'collection-1'
const inventory = {
  [collectionId]: {
    meta: { name: 'Field notes' },
    items: {
      one: {
        tokenId: '1',
        name: 'First item',
        openSeaLink: 'https://example.test/assets/1'
      }
    }
  }
}

const inventoryStore =
  (value) =>
  (...path) => {
    if (path.join('.') === `main.inventory.${account}`) return value
    if (path.join('.') === `main.inventory.${account}.${collectionId}`) return value?.[collectionId]
  }

class InventoryPreviewHarness extends InventoryPreview {
  store(...path) {
    return this.props.readStore(...path)
  }
}

class InventoryExpandedHarness extends InventoryExpanded {
  store(...path) {
    return this.props.readStore(...path)
  }
}

class InventoryCollectionHarness extends InventoryCollection {
  constructor(props) {
    super(props)
    this.store = props.readStore
  }
}

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    disconnect() {}
  }
})

afterAll(() => {
  delete global.ResizeObserver
})

it('opens inventory from a native Wren control', async () => {
  const { user } = render(
    <InventoryPreviewHarness account={account} moduleId='inventory' readStore={inventoryStore(inventory)} />
  )

  const more = screen.getByRole('button', { name: 'More' })
  expect(more.classList.contains('wrenControl')).toBe(true)
  await user.click(more)

  expect(link.send).toHaveBeenCalledWith('nav:forward', 'panel', {
    view: 'expandedModule',
    data: { id: 'inventory', account }
  })
})

it('uses calm empty-state copy in compact and expanded inventory', () => {
  const emptyStore = inventoryStore({})
  const view = render(
    <InventoryPreviewHarness account={account} moduleId='inventory' readStore={emptyStore} />
  )
  expect(screen.getByText('No collectibles yet')).toBeTruthy()
  expect(document.querySelector('.wrenEmptyStateImage')).toBeTruthy()
  view.unmount()

  render(<InventoryExpandedHarness account={account} moduleId='inventory' readStore={emptyStore} />)
  expect(screen.getByText('No collectibles yet')).toBeTruthy()
  expect(document.querySelector('.wrenEmptyStateExpanded')).toBeTruthy()
})

it('shows a plain filtered miss when inventory exists', () => {
  render(
    <InventoryPreviewHarness
      account={account}
      moduleId='inventory'
      filter='not-present'
      readStore={inventoryStore(inventory)}
    />
  )

  expect(screen.getByText('No matching collectibles')).toBeTruthy()
  expect(document.querySelector('.wrenEmptyStateImage')).toBeNull()
})

it('previews and opens a collectible from the keyboard', async () => {
  const readStore = inventoryStore(inventory)
  readStore.notify = jest.fn()
  const { user } = render(
    <InventoryCollectionHarness
      account={account}
      expandedData={{ currentCollection: collectionId }}
      readStore={readStore}
    />
  )

  const asset = screen.getByRole('button', { name: 'Open First item in browser' })
  await user.tab()
  expect(document.activeElement).toBe(asset)
  expect(screen.getByText('First item')).toBeTruthy()
  await user.keyboard('{Enter}')

  expect(readStore.notify).toHaveBeenCalledWith('openExternal', {
    url: 'https://example.test/assets/1'
  })
})
