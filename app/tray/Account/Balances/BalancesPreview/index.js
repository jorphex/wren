import React from 'react'
import Restore from 'react-restore'
import { safeNetworkMetadata } from '../../../../../resources/domain/networkMetadata'
import BigNumber from 'bignumber.js'

import emptyBalances from 'url:../../../../../asset/ui/wren-empty-balances-v2.png'

import Icon from '../../../../../resources/Components/Icon'
import link from '../../../../../resources/link'
import { isNetworkConnected } from '../../../../../resources/utils/chains'
import {
  createBalance,
  sortByTotalValue as byTotalValue,
  isNativeCurrency
} from '../../../../../resources/domain/balance'
import { matchFilter } from '../../../../../resources/utils'

import { Cluster, ClusterRow, ClusterValue } from '../../../../../resources/Components/Cluster'
import WrenEmptyState from '../../../../../resources/Components/WrenEmptyState'

import Balance from '../Balance'

export class BalancesPreview extends React.Component {
  constructor(...args) {
    super(...args)
    this.moduleRef = React.createRef()
    if (!this.props.expanded) {
      this.resizeObserver = new ResizeObserver(() => {
        clearTimeout(this.resizeTimer)
        this.resizeTimer = setTimeout(() => {
          if (this.moduleRef && this.moduleRef.current) {
            link.send('tray:action', 'updateAccountModule', this.props.moduleId, {
              height: this.moduleRef.current.scrollHeight
            })
          }
        }, 100)
      })
    }

    this.state = {
      openActive: false,
      open: false,
      selected: 0,
      shadowTop: 0,
      expand: false
    }
  }

  componentDidMount() {
    if (this.resizeObserver) this.resizeObserver.observe(this.moduleRef.current)
  }

  componentWillUnmount() {
    if (this.resizeObserver) this.resizeObserver.disconnect()
  }

  getBalances(rawBalances, rates) {
    const networks = this.store('main.networks.ethereum')
    const networksMeta = this.store('main.networksMeta.ethereum')

    return (
      rawBalances
        // only show balances from connected networks
        .filter((rawBalance) => isNetworkConnected(networks[rawBalance.chainId]))
        .map((rawBalance) => {
          const isNative = isNativeCurrency(rawBalance.address)
          const nativeCurrencyInfo = safeNetworkMetadata(
            networksMeta?.[rawBalance.chainId],
            networks[rawBalance.chainId]
          ).nativeCurrency

          const rate = isNative ? nativeCurrencyInfo : rates[rawBalance.address || rawBalance.symbol] || {}
          const logoURI = (isNative && nativeCurrencyInfo.icon) || rawBalance.logoURI
          const name = isNative
            ? nativeCurrencyInfo.name || networks[rawBalance.chainId].name
            : rawBalance.name
          const decimals = isNative ? nativeCurrencyInfo.decimals || 18 : rawBalance.decimals
          const symbol = (isNative && nativeCurrencyInfo.symbol) || rawBalance.symbol

          return {
            ...createBalance(
              { ...rawBalance, logoURI, name, decimals, symbol },
              networks[rawBalance.chainId].isTestnet ? { price: 0 } : rate.usd
            ),
            native: isNative
          }
        })
        .sort(byTotalValue)
    )
  }

  render() {
    const { address, lastSignerType } = this.store('main.accounts', this.props.account)
    const storedBalances = this.store('main.balances', address) || []
    const rates = this.store('main.rates')

    const allBalances = this.getBalances(storedBalances, rates)

    // if filter only show balances that match filter
    const filteredBalances = allBalances.filter((balance) => {
      const { filter = '' } = this.props
      const chainName = this.store('main.networks.ethereum', balance.chainId, 'name')
      return matchFilter(filter, [chainName, balance.name, balance.symbol])
    })

    const totalValue = filteredBalances.reduce((a, b) => a.plus(b.totalValue), BigNumber(0))
    const lastBalanceUpdate = this.store('main.accounts', address, 'balances.lastUpdated')

    const balances = filteredBalances.slice(0, 4)

    // scan if balances are more than a minute old
    const scanning = !lastBalanceUpdate || new Date() - new Date(lastBalanceUpdate) > 1000 * 60
    const hotSigner = ['ring', 'seed'].includes(lastSignerType)
    const hideBalances = this.store('selected.hideBalances')

    return (
      <div ref={this.moduleRef} className='balancesBlock balancesPreview'>
        <div className={'moduleHeader'}>
          <span>
            <Icon name='tokens' size={16} />
          </span>
          <span>{'Balances'}</span>
        </div>
        {scanning ? (
          <div className='signerBalancesLoading'>
            <div className='loader' />
          </div>
        ) : balances.length === 0 ? (
          this.props.filter ? (
            <div className='wrenEmptyFilter'>No matching balances</div>
          ) : (
            <WrenEmptyState
              image={emptyBalances}
              transparentImage={true}
              title='No balances yet'
              copy='Assets appear here after Wren checks your enabled networks.'
            />
          )
        ) : (
          <Cluster>
            {balances.map(({ chainId, symbol, ...balance }, i) => {
              return (
                <ClusterRow key={chainId + symbol}>
                  <ClusterValue>
                    <Balance chainId={chainId} symbol={symbol} balance={balance} i={i} scanning={scanning} />
                  </ClusterValue>
                </ClusterRow>
              )
            })}
          </Cluster>
        )}
        {balances.length > 0 || this.props.expanded ? (
          <div className='signerBalanceTotal' style={{ opacity: !scanning ? 1 : 0 }}>
            {!this.props.expanded ? (
              <div className='signerBalanceButtons'>
                <button
                  type='button'
                  className='signerBalanceButton signerBalanceShowAll wrenControl wrenControlGhost wrenControlCompact'
                  onClick={() => {
                    const crumb = {
                      view: 'expandedModule',
                      data: {
                        id: this.props.moduleId,
                        account: this.props.account
                      }
                    }
                    link.send('nav:forward', 'panel', crumb)
                  }}
                >
                  {filteredBalances.length - balances.length > 0
                    ? `View ${filteredBalances.length - balances.length} more balances`
                    : 'View all balances'}
                </button>
              </div>
            ) : (
              <div className='signerBalanceButtons'>
                <button
                  type='button'
                  className='signerBalanceButton signerBalanceAddToken wrenControl wrenControlSecondary wrenControlCompact'
                  onClick={() => {
                    link.send('tray:action', 'navDash', { view: 'tokens', data: { notify: 'addToken' } })
                  }}
                >
                  <span>Add token</span>
                </button>
              </div>
            )}
          </div>
        ) : null}
        {!hideBalances && totalValue.toNumber() > 10000 && hotSigner ? (
          <button
            type='button'
            className='signerBalanceWarning'
            aria-expanded={this.state.showHighHotMessage || false}
            onClick={() => this.setState({ showHighHotMessage: !this.state.showHighHotMessage })}
            style={scanning ? { opacity: 0 } : { opacity: 1 }}
          >
            <div className='signerBalanceWarningTitle'>High-value account uses a hot signer</div>
            {this.state.showHighHotMessage ? (
              <div className='signerBalanceWarningMessage'>
                {'Use a hardware signer to better protect this account.'}
              </div>
            ) : null}
          </button>
        ) : null}
      </div>
    )
  }
}

export default Restore.connect(BalancesPreview)
