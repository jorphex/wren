import React from 'react'
import Restore from 'react-restore'
import BigNumber from 'bignumber.js'

import emptyBalances from 'url:../../../../../asset/ui/wren-empty-balances-v2.png'

import Icon from '../../../../../resources/Components/Icon'
import link from '../../../../../resources/link'
import { isNetworkConnected } from '../../../../../resources/utils/chains'
import Balance from '../Balance'
import {
  formatUsdRate,
  createBalance,
  sortByTotalValue as byTotalValue,
  isNativeCurrency
} from '../../../../../resources/domain/balance'
import { matchFilter } from '../../../../../resources/utils'
import { safeNetworkMetadata } from '../../../../../resources/domain/networkMetadata'

import { Cluster, ClusterRow, ClusterValue } from '../../../../../resources/Components/Cluster'
import WrenEmptyState from '../../../../../resources/Components/WrenEmptyState'

export class BalancesExpanded extends React.Component {
  constructor(...args) {
    super(...args)
    this.moduleRef = React.createRef()

    this.state = {
      openActive: false,
      open: false,
      selected: 0,
      shadowTop: 0,
      expand: false,
      balanceFilter: ''
    }
  }

  getBalances(rawBalances, rates) {
    const networks = this.store('main.networks.ethereum')
    const networksMeta = this.store('main.networksMeta.ethereum')

    const balances = rawBalances
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
        const name = isNative ? nativeCurrencyInfo.name || networks[rawBalance.chainId].name : rawBalance.name
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
      .filter((balance) => {
        const filter = this.state.balanceFilter
        const chainName = this.store('main.networks.ethereum', balance.chainId, 'name')
        return matchFilter(filter, [chainName, balance.name, balance.symbol])
      })
      .sort(byTotalValue)

    const totalValue = balances.reduce((a, b) => a.plus(b.totalValue), BigNumber(0))

    return { balances, totalDisplayValue: formatUsdRate(totalValue, 0), totalValue }
  }

  renderAccountFilter() {
    const hasFilter = Boolean(this.state.balanceFilter)

    return (
      <div className={`panelFilterAccount balanceFilter${hasFilter ? ' balanceFilterHasValue' : ''}`}>
        <div className='panelFilterIcon'>
          <Icon name='search' size={15} />
        </div>
        <div className='panelFilterInput'>
          <input
            aria-label='Filter balances'
            className='wrenInput wrenInputQuiet'
            type='text'
            spellCheck='false'
            onChange={(e) => {
              const value = e.target.value
              this.setState({ balanceFilter: value })
            }}
            value={this.state.balanceFilter}
          />
        </div>
        {hasFilter ? (
          <button
            type='button'
            aria-label='Clear balance filter'
            className='panelFilterClear wrenControl wrenControlGhost wrenControlIcon'
            onClick={() => {
              this.setState({ balanceFilter: '' })
            }}
          >
            <Icon name='close' size={12} />
          </button>
        ) : null}
      </div>
    )
  }

  render() {
    const { address, lastSignerType } = this.store('main.accounts', this.props.account)
    const storedBalances = this.store('main.balances', address) || []
    const rates = this.store('main.rates')

    const { balances: allBalances, totalDisplayValue, totalValue } = this.getBalances(storedBalances, rates)
    const balances = allBalances.slice(0, this.props.expanded ? allBalances.length : 4)

    const lastBalanceUpdate = this.store('main.accounts', address, 'balances.lastUpdated')

    // scan if balances are more than a minute old
    const scanning = !lastBalanceUpdate || new Date() - new Date(lastBalanceUpdate) > 1000 * 60
    const hotSigner = ['ring', 'seed'].includes(lastSignerType)
    const hideBalances = this.store('selected.hideBalances')

    return (
      <div className='accountViewScroll accountLedgerView balancesExpandedView'>
        {this.renderAccountFilter()}
        <div className='balancesExpandedScroll'>
          {scanning ? (
            <div className='signerBalancesLoading'>
              <div className='loader' />
            </div>
          ) : null}
          {!scanning && balances.length === 0 ? (
            this.state.balanceFilter ? (
              <div className='wrenEmptyFilter'>No matching balances</div>
            ) : (
              <WrenEmptyState
                image={emptyBalances}
                transparentImage={true}
                title='No balances yet'
                copy='Assets appear here after Wren checks your enabled networks.'
                expanded
              />
            )
          ) : (
            <Cluster>
              {balances.map(({ chainId, symbol, ...balance }, i) => {
                return (
                  <ClusterRow key={chainId + symbol}>
                    <ClusterValue>
                      <Balance
                        chainId={chainId}
                        symbol={symbol}
                        balance={balance}
                        i={i}
                        scanning={scanning}
                      />
                    </ClusterValue>
                  </ClusterRow>
                )
              })}
            </Cluster>
          )}
          <div className='signerBalanceTotal' style={{ opacity: !scanning ? 1 : 0 }}>
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
            <div className='signerBalanceTotalText'>
              <div className='signerBalanceTotalLabel'>{'Total'}</div>
              <div className='signerBalanceTotalValue'>
                {hideBalances ? (
                  <span aria-label='Total balance hidden'>$••••</span>
                ) : (
                  <>
                    <span aria-hidden='true'>$</span>
                    {balances.length > 0 ? totalDisplayValue : '---.--'}
                  </>
                )}
              </div>
            </div>
          </div>
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
      </div>
    )
  }
}

export default Restore.connect(BalancesExpanded)
