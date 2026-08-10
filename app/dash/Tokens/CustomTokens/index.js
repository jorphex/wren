import React from 'react'
import Restore from 'react-restore'
import emptyCustomTokens from 'url:../../../../asset/ui/empty-custom-tokens-v1.png'
import Icon from '../../../../resources/Components/Icon'
import link from '../../../../resources/link'
import { safeRemoteImageUrl } from '../../../../resources/utils/image'

const tokenIdentity = (token) => `${token.chainId}:${token.address.toLowerCase()}`
const sortTokens = (tokens) =>
  [...tokens].sort((a, b) => {
    const chainOrder = Number(a.chainId) - Number(b.chainId)
    return chainOrder || a.address.toLowerCase().localeCompare(b.address.toLowerCase())
  })

class CustomTokens extends React.Component {
  constructor(props, context) {
    super(props, context)
    this.state = {
      copiedTokenIds: [],
      focusAfterRemovalId: null,
      navigatingTokenId: null,
      removalConfirmTokenId: null,
      removingTokenId: null,
      tokenExpanded: null
    }
    this.copyTimers = new Map()
    this.expandButtons = new Map()
    this.removeButtons = new Map()
    this.removeConfirmButtons = new Map()
    this.listRef = React.createRef()
    this.removeTimer = null
    this.removePending = false
    this.navigationPending = false
  }

  componentDidUpdate() {
    const { removingTokenId } = this.state
    if (
      removingTokenId &&
      !this.store('main.tokens.custom').some((token) => tokenIdentity(token) === removingTokenId)
    ) {
      const { focusAfterRemovalId } = this.state
      this.removePending = false
      this.setState({ focusAfterRemovalId: null, removalConfirmTokenId: null, removingTokenId: null }, () => {
        const focusTarget = this.expandButtons.get(focusAfterRemovalId) || this.listRef.current
        focusTarget?.focus()
      })
    }
  }

  componentWillUnmount() {
    this.copyTimers.forEach((timer) => clearTimeout(timer))
    this.copyTimers.clear()
    this.expandButtons.clear()
    this.removeButtons.clear()
    this.removeConfirmButtons.clear()
    clearTimeout(this.removeTimer)
    this.removePending = false
    this.navigationPending = false
  }

  copyAddress(token) {
    const tokenId = tokenIdentity(token)

    link.send('tray:clipboardData', token.address)
    clearTimeout(this.copyTimers.get(tokenId))
    this.setState(({ copiedTokenIds }) => ({
      copiedTokenIds: copiedTokenIds.includes(tokenId) ? copiedTokenIds : [...copiedTokenIds, tokenId]
    }))

    this.copyTimers.set(
      tokenId,
      setTimeout(() => {
        this.copyTimers.delete(tokenId)
        this.setState(({ copiedTokenIds }) => ({
          copiedTokenIds: copiedTokenIds.filter((copiedTokenId) => copiedTokenId !== tokenId)
        }))
      }, 1000)
    )
  }

  editToken(token) {
    if (this.navigationPending) return
    this.navigationPending = true
    this.setState({ navigatingTokenId: tokenIdentity(token) })
    link.send('nav:forward', 'dash', {
      view: 'tokens',
      data: {
        notify: 'addToken',
        notifyData: {
          error: null,
          isEdit: true,
          address: token.address,
          chain: { id: token.chainId },
          tokenData: token
        }
      }
    })
  }

  removeToken(token) {
    if (this.removePending || this.state.removalConfirmTokenId !== null) return

    const tokenId = tokenIdentity(token)
    this.setState({ removalConfirmTokenId: tokenId }, () => this.removeConfirmButtons.get(tokenId)?.focus())
  }

  cancelTokenRemoval(tokenId) {
    if (this.removePending || this.state.removalConfirmTokenId !== tokenId) return
    this.setState({ removalConfirmTokenId: null }, () => this.removeButtons.get(tokenId)?.focus())
  }

  confirmTokenRemoval(token) {
    const tokenId = tokenIdentity(token)
    if (this.removePending || this.state.removalConfirmTokenId !== tokenId) return

    const orderedTokenIds = sortTokens(this.store('main.tokens.custom')).map(tokenIdentity)
    const tokenIndex = orderedTokenIds.indexOf(tokenId)
    const focusAfterRemovalId = orderedTokenIds[tokenIndex + 1] || orderedTokenIds[tokenIndex - 1] || null
    this.removePending = true
    this.setState({ focusAfterRemovalId, removingTokenId: tokenId })
    this.removeTimer = setTimeout(() => {
      this.removeTimer = null
      link.send('tray:removeToken', token)
    }, 100)
  }

  render() {
    const tokens = this.store('main.tokens.custom')
    const { copiedTokenIds, navigatingTokenId, removalConfirmTokenId, removingTokenId, tokenExpanded } =
      this.state
    const removalActive = removalConfirmTokenId !== null || removingTokenId !== null

    return (
      <div className='cardShow' onMouseDown={(e) => e.stopPropagation()}>
        <div className='customTokens'>
          <div ref={this.listRef} className='customTokensList' tabIndex={-1} aria-label='Custom tokens'>
            {tokens.length > 0 ? (
              sortTokens(tokens).map((token) => {
                const tokenId = tokenIdentity(token)
                const copied = copiedTokenIds.includes(tokenId)
                const expanded = tokenExpanded === tokenId

                return (
                  <div
                    key={tokenId}
                    className={
                      expanded ? 'customTokensListItem customTokensListItemExpanded' : 'customTokensListItem'
                    }
                  >
                    <div className='customTokensListItemTitle'>
                      <div className='customTokensListItemName'>
                        <img
                          src={safeRemoteImageUrl(token.logoURI)}
                          value={token.symbol.toUpperCase()}
                          alt={token.symbol.toUpperCase()}
                        />
                        <div className='customTokensListItemText'>
                          <div className='customTokensListItemSymbol'>{token.symbol}</div>
                          <div className='customTokensListItemSub'>{token.name}</div>
                        </div>
                      </div>
                      <div className='customTokensListItemChain'>
                        <div className='customTokensListItemChainLabel'>{'Chain ID:'}</div>
                        <div>{token.chainId}</div>
                        <button
                          ref={(node) => {
                            if (node) this.expandButtons.set(tokenId, node)
                            else this.expandButtons.delete(tokenId)
                          }}
                          type='button'
                          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${token.symbol} token on chain ${token.chainId}`}
                          aria-expanded={expanded}
                          disabled={removalActive}
                          className={
                            expanded
                              ? 'customTokensListItemExpand'
                              : 'customTokensListItemExpand customTokensListItemExpandActive'
                          }
                          onClick={() => this.setState({ tokenExpanded: expanded ? null : tokenId })}
                        >
                          <Icon name='chevron-down' size={16} />
                        </button>
                      </div>
                    </div>
                    {expanded && (
                      <>
                        <button
                          type='button'
                          aria-label={`Copy ${token.symbol} token address`}
                          className='customTokensListItemAddress'
                          disabled={removalActive}
                          onClick={() => this.copyAddress(token)}
                        >
                          {copied ? 'Address Copied' : token.address}
                        </button>
                        <span className='customTokensCopyStatus' role='status' aria-live='polite'>
                          {copied ? `${token.symbol} token address copied` : ''}
                        </span>
                        {removalConfirmTokenId === tokenId ? (
                          <div className='customTokensListItemRemoval' role='alertdialog'>
                            <strong>{`Remove ${token.symbol}?`}</strong>
                            <span>
                              This removes the custom token from Wren. On-chain assets are not affected.
                            </span>
                            <div className='customTokensListItemRemovalActions'>
                              <button
                                ref={(node) => {
                                  if (node) this.removeConfirmButtons.set(tokenId, node)
                                  else this.removeConfirmButtons.delete(tokenId)
                                }}
                                type='button'
                                className='customTokensListItemButton'
                                disabled={removingTokenId !== null}
                                onClick={() => this.cancelTokenRemoval(tokenId)}
                              >
                                Cancel
                              </button>
                              <button
                                type='button'
                                className='customTokensListItemButton removeButton'
                                disabled={removingTokenId !== null}
                                onClick={() => this.confirmTokenRemoval(token)}
                              >
                                Remove token
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className='customTokensListItemBottom'>
                            <button
                              type='button'
                              aria-label={`Edit ${token.symbol} token`}
                              className='customTokensListItemButton editButton'
                              disabled={navigatingTokenId !== null || removalActive}
                              onClick={() => this.editToken(token)}
                            >
                              {navigatingTokenId === tokenId ? 'Opening token' : 'Edit token'}
                            </button>
                            <button
                              ref={(node) => {
                                if (node) this.removeButtons.set(tokenId, node)
                                else this.removeButtons.delete(tokenId)
                              }}
                              type='button'
                              aria-label={`Remove ${token.symbol} token`}
                              disabled={removalActive}
                              className='customTokensListItemButton removeButton'
                              onClick={() => this.removeToken(token)}
                            >
                              Remove token
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )
              })
            ) : (
              <div className='customTokensListNoTokens'>
                <img alt='' aria-hidden='true' src={emptyCustomTokens} />
                <strong>No custom tokens</strong>
                <span>Add a token contract to keep it available in Wren.</span>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }
}

export default Restore.connect(CustomTokens)
