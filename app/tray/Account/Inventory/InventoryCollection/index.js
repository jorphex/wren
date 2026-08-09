import React from 'react'
import Restore from 'react-restore'
import { safeRemoteImageUrl } from '../../../../../resources/utils/image'

export class Inventory extends React.Component {
  constructor(...args) {
    super(...args)
    this.state = {
      hoverAsset: false
    }
  }

  render() {
    const inventory = this.store('main.inventory', this.props.account)
    const expandedData = this.props.expandedData || {}
    const k = expandedData.currentCollection
    return (
      <div className='inventoryDisplay'>
        <div className='inventoryPreview'>
          {this.state.hoverAsset ? (
            <div className='inventoryPreviewMedia'>
              {this.state.hoverAsset.img ? (
                <img
                  src={safeRemoteImageUrl(this.state.hoverAsset.img)}
                  loading='lazy'
                  alt={this.state.hoverAsset.name.toUpperCase()}
                />
              ) : null}
            </div>
          ) : (
            <div
              className='inventoryPreviewCollection'
              style={
                inventory[k].meta.image
                  ? {
                      backgroundImage: `url(${JSON.stringify(safeRemoteImageUrl(inventory[k].meta.image))})`
                    }
                  : {}
              }
            />
          )}
        </div>
        <div className='inventoryPreviewTitle'>
          {this.state.hoverAsset ? this.state.hoverAsset.name : inventory[k].meta.name}
        </div>
        <div className='inventoryCollectionItems'>
          {Object.keys(inventory[k].items || {})
            .sort((a, b) => {
              a = inventory[k].items[a].tokenId
              b = inventory[k].items[b].tokenId
              return a < b ? -1 : b > a ? 1 : 0
            })
            .map((id) => {
              const { tokenId, name, img, openSeaLink } = inventory[k].items[id]
              return (
                <button
                  type='button'
                  key={id}
                  className='inventoryCollectionItem'
                  aria-label={`Open ${name || `token ${tokenId}`} in browser`}
                  onClick={() => {
                    this.store.notify('openExternal', { url: openSeaLink })
                  }}
                  onFocus={() => {
                    this.setState({
                      hoverAsset: {
                        name,
                        tokenId,
                        img
                      }
                    })
                  }}
                  onBlur={() => {
                    this.setState({
                      hoverAsset: false
                    })
                  }}
                  onMouseEnter={() => {
                    this.setState({
                      hoverAsset: {
                        name,
                        tokenId,
                        img
                      }
                    })
                  }}
                  onMouseLeave={(event) => {
                    if (document.activeElement !== event.currentTarget) this.setState({ hoverAsset: false })
                  }}
                >
                  {img ? (
                    <div className='inventoryItemImage'>
                      <img src={safeRemoteImageUrl(img)} loading='lazy' alt={name.toUpperCase()} />
                    </div>
                  ) : null}
                </button>
              )
            })}
          <div className='inventoryCollectionLine' />
        </div>
      </div>
    )
  }
}

export default Restore.connect(Inventory)
