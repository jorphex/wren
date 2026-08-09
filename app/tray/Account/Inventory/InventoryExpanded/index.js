import React from 'react'
import Restore from 'react-restore'

import emptyInventory from 'url:../../../../../asset/ui/wren-empty-inventory-v1.png'

import link from '../../../../../resources/link'

import { ClusterBox, Cluster, ClusterRow, ClusterValue } from '../../../../../resources/Components/Cluster'
import WrenEmptyState from '../../../../../resources/Components/WrenEmptyState'

export class InventoryExpanded extends React.Component {
  constructor(...args) {
    super(...args)
    this.state = {
      hoverAsset: false
    }
  }

  displayCollections() {
    const inventory = this.store('main.inventory', this.props.account)
    const collections = Object.keys(inventory || {})
    return collections
      .sort((a, b) => {
        const assetsLengthA = Object.keys(inventory[a].items).length
        const assetsLengthB = Object.keys(inventory[b].items).length
        if (assetsLengthA > assetsLengthB) return -1
        if (assetsLengthA < assetsLengthB) return 1
        return 0
      })
      .slice(0, this.props.expanded ? this.length : 6)
  }

  renderInventoryList() {
    const inventory = this.store('main.inventory', this.props.account)
    const displayCollections = this.displayCollections()
    return displayCollections.map((k) => {
      return (
        <ClusterRow key={k}>
          <ClusterValue
            ariaLabel={`Open ${inventory[k].meta.name || k} collection`}
            onClick={() => {
              const crumb = {
                view: 'expandedModule',
                data: {
                  id: this.props.moduleId,
                  account: this.props.account,
                  currentCollection: k
                }
              }
              link.send('nav:forward', 'panel', crumb)
            }}
          >
            <div key={k} className='inventoryCollection'>
              <div className='inventoryCollectionTop'>
                <div className='inventoryCollectionName'>{inventory[k].meta.name}</div>
                <div className='inventoryCollectionCount'>{Object.keys(inventory[k].items).length}</div>
                <div className='inventoryCollectionLine' />
              </div>
            </div>
          </ClusterValue>
        </ClusterRow>
      )
    })
  }

  render() {
    const inventory = this.store('main.inventory', this.props.account)
    const collections = Object.keys(inventory || {})
    return (
      <div className='accountViewScroll accountLedgerView'>
        {collections.length ? (
          <ClusterBox>
            <Cluster>{this.renderInventoryList()}</Cluster>
          </ClusterBox>
        ) : inventory ? (
          <WrenEmptyState
            image={emptyInventory}
            title='No collectibles yet'
            copy='Collectibles associated with this account appear here.'
            expanded
          />
        ) : (
          <div className='inventoryNotFound'>Loading collectibles…</div>
        )}
      </div>
    )
  }
}

export default Restore.connect(InventoryExpanded)
