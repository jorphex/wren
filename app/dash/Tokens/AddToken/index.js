import { isValidAddress } from '@ethereumjs/util'
import { Component, useEffect, useRef, useState } from 'react'
import Restore from 'react-restore'
import Icon from '../../../../resources/Components/Icon'
import RingIcon from '../../../../resources/Components/RingIcon'
import link from '../../../../resources/link'

const invalidFormatError = 'INVALID CONTRACT ADDRESS'
const unableToVerifyError = `COULD NOT FIND TOKEN WITH ADDRESS`

const navForward = async (notifyData) =>
  link.send('nav:forward', 'dash', {
    view: 'tokens',
    data: {
      notify: 'addToken',
      notifyData
    }
  })

const navBack = async (steps = 1) => link.send('nav:back', 'dash', steps)

const TokenError = ({ text, onContinue }) => {
  const handledRef = useRef(false)
  const handleOnce = (action) => {
    if (handledRef.current) return
    handledRef.current = true
    action()
  }

  return (
    <div className='newTokenView cardShow'>
      <div className='newTokenErrorTitle'>{text}</div>

      <button type='button' className='tokenSetAddress' onClick={() => handleOnce(() => navBack())}>
        {'BACK'}
      </button>
      {text.includes(unableToVerifyError) && (
        <button
          type='button'
          className='tokenSetAddress'
          onClick={() =>
            handleOnce(() => {
              navBack()
              onContinue()
            })
          }
        >
          {'ADD ANYWAY'}
        </button>
      )}
    </div>
  )
}

class AddTokenChainScreenComponent extends Component {
  state = { selectingChainId: null }

  componentWillUnmount() {
    this.selectionPending = false
    clearTimeout(this.selectionTimer)
  }

  selectChain(chain, primaryColor) {
    if (this.selectionPending) return

    const chainId = chain.id
    this.selectionPending = true
    this.setState({ selectingChainId: chainId })
    this.selectionTimer = setTimeout(() => {
      link.send('tray:action', 'navDash', {
        view: 'tokens',
        data: {
          notify: 'addToken',
          notifyData: { chain: { id: chainId, color: primaryColor, name: chain.name } }
        }
      })
    }, 200)
  }

  openChains() {
    if (this.selectionPending) return
    this.selectionPending = true
    this.setState({ selectingChainId: 'chains' })
    link.send('tray:action', 'navDash', { view: 'chains', data: {} })
  }

  render() {
    const activeChains = Object.values(this.store('main.networks.ethereum')).filter((chain) => chain.on)

    return (
      <div className='newTokenView cardShow'>
        <div className='newTokenChainSelectTitle'>{`Select token's chain`}</div>
        <div className='newTokenChainSelectChain'>
          <div className='originSwapChainList'>
            {activeChains.map((chain) => {
              const chainId = chain.id
              const { primaryColor, icon } = this.store('main.networksMeta.ethereum', chainId)

              return (
                <button
                  type='button'
                  className='originChainItem'
                  key={chainId}
                  disabled={this.state.selectingChainId !== null}
                  onClick={() => this.selectChain(chain, primaryColor)}
                >
                  <div className='originChainItemIcon'>
                    <RingIcon
                      color={primaryColor ? `var(--${primaryColor})` : 'var(--moon)'}
                      img={icon}
                      small={true}
                    />
                  </div>
                  {chain.name}
                </button>
              )
            })}
          </div>
        </div>
        <div className='newTokenChainSelectFooter'>
          {'Chain not listed?'}
          <button
            type='button'
            className='newTokenEnableChainLink'
            role='link'
            disabled={this.state.selectingChainId !== null}
            onClick={() => this.openChains()}
          >
            {'Enable it in Chains'}
          </button>
        </div>
      </div>
    )
  }
}

const SelectChain = Restore.connect(AddTokenChainScreenComponent)

const EnterAddress = ({ chain }) => {
  const [isFetching, setFetching] = useState(false)
  const [isSubmitting, setSubmitting] = useState(false)
  const [contractAddress, setAddress] = useState('')
  const mountedRef = useRef(true)
  const submittingRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const { name: chainName, color } = chain

  const resolveTokenData = async () => {
    setFetching(true)

    let tokenData = {}
    try {
      tokenData = (await link.invoke('tray:getTokenDetails', contractAddress, chain.id)) || {}
    } catch {
      tokenData = {}
    }
    if (!mountedRef.current) return

    const error = tokenData.totalSupply ? null : `${unableToVerifyError} ${contractAddress}`
    return navForward({ error, tokenData, address: contractAddress, chain })
  }

  const submit = () => {
    if (submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)

    if (!isValidAddress(contractAddress))
      return navForward({
        error: invalidFormatError,
        address: contractAddress,
        chain
      })

    resolveTokenData()
  }

  return (
    <div className='newTokenView cardShow'>
      {isFetching ? (
        <>
          <div className='signerLoading'>
            <div className='signerLoadingLoader' />
          </div>
          {'FETCHING TOKEN DATA'}
        </>
      ) : (
        <>
          <div className='newTokenChainSelectTitle'>
            <label id='newTokenAddressLabel'>{`Enter token's address`}</label>

            {chainName && (
              <div
                className='newTokenChainSelectSubtitle'
                style={{
                  color: color ? `var(--${color})` : 'var(--moon)'
                }}
              >
                {`on ${chainName}`}
              </div>
            )}
          </div>

          <div className='tokenRow'>
            <div className='tokenAddress'>
              <input
                aria-labelledby='newTokenAddressLabel'
                className='tokenInput tokenInputAddress'
                value={contractAddress}
                disabled={isSubmitting}
                spellCheck={false}
                autoFocus={true}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    if (e.repeat) return
                    submit()
                  }
                }}
                onChange={(e) => {
                  if (e.target.value.length > 42) {
                    e.preventDefault()
                  } else {
                    setAddress(e.target.value)
                  }
                }}
              />
            </div>
          </div>
          <button type='button' className='tokenSetAddress' disabled={isSubmitting} onClick={submit}>
            {'Set Address'}
          </button>
        </>
      )}
    </div>
  )
}

const tokenDetailsDefaults = {
  name: 'Token Name',
  symbol: 'Symbol',
  decimals: '?',
  logoURI: 'Logo URI'
}

const TokenDetailsForm = ({ req, chain, tokenData, isEdit }) => {
  const [name, setName] = useState(tokenData.name || tokenDetailsDefaults.name)
  const [symbol, setSymbol] = useState(tokenData.symbol || tokenDetailsDefaults.symbol)
  const [decimals, setDecimals] = useState(tokenData.decimals ?? tokenDetailsDefaults.decimals)
  const [logoUri, setLogoUri] = useState(tokenData.logoURI || tokenDetailsDefaults.logoURI)
  const [isSaving, setSaving] = useState(false)

  const savingRef = useRef(false)
  const navigationTimerRef = useRef()

  const { address } = tokenData
  const { name: chainName, color } = chain

  const newTokenReady =
    name &&
    name !== tokenDetailsDefaults.name &&
    symbol &&
    symbol !== tokenDetailsDefaults.symbol &&
    Number.isInteger(chain.id) &&
    Number.isInteger(decimals)

  const saveAndClose = () => {
    if (!newTokenReady || savingRef.current) return
    savingRef.current = true
    setSaving(true)

    const token = {
      name,
      symbol,
      chainId: chain.id,
      address,
      decimals,
      logoURI: logoUri === tokenDetailsDefaults.logoURI ? '' : logoUri
    }

    const backSteps = isEdit ? 2 : 4

    link.send('tray:addToken', token, req)

    navigationTimerRef.current = setTimeout(() => {
      navBack(backSteps)
      link.send('nav:forward', 'dash', {
        view: 'tokens',
        data: {}
      })
    }, 250)
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && newTokenReady) {
      e.stopPropagation()
      saveAndClose()
    }
  }

  useEffect(() => {
    return () => clearTimeout(navigationTimerRef.current)
  }, [])

  return (
    <div className='notifyBoxWrap cardShow' onMouseDown={(e) => e.stopPropagation()}>
      <div className='notifyBoxSlide'>
        <div className='addTokenTop'>
          <div className='addTokenTitle' data-testid='addTokenFormTitle'>
            {isEdit ? 'Edit Token' : 'Add New Token'}
          </div>
          <div className='newTokenChainSelectTitle'>
            <div className='newTokenChainAddress' role='heading' aria-level='2'>
              {address.substring(0, 10)}
              <Icon name='ellipsis' size={14} />
              {address.substring(address.length - 8)}
            </div>
            {chainName ? (
              <div
                className='newTokenChainSelectSubtitle'
                style={{
                  color: color ? `var(--${color})` : 'var(--moon)'
                }}
              >
                {`on ${chainName}`}
              </div>
            ) : null}
          </div>
        </div>
        <div className='addToken'>
          <div className='tokenRow'>
            <div className='tokenName'>
              <label className='tokenInputLabel'>
                <input
                  className={`tokenInput ${name === tokenDetailsDefaults.name ? 'tokenInputDim' : ''}`}
                  value={name}
                  disabled={isSaving}
                  spellCheck={false}
                  onChange={(e) => {
                    setName(e.target.value)
                  }}
                  onFocus={(e) => {
                    if (e.target.value === tokenDetailsDefaults.name) setName('')
                  }}
                  onBlur={(e) => {
                    if (e.target.value === '') setName(tokenDetailsDefaults.name)
                  }}
                  onKeyDown={handleKeyPress}
                />
                Token Name
              </label>
            </div>
          </div>

          <div className='tokenRow'>
            <div className='tokenSymbol'>
              <label className='tokenInputLabel'>
                <input
                  className={`tokenInput ${symbol === tokenDetailsDefaults.symbol ? 'tokenInputDim' : ''}`}
                  value={symbol}
                  disabled={isSaving}
                  spellCheck={false}
                  onChange={(e) => {
                    if (e.target.value.length > 10) return e.preventDefault()
                    setSymbol(e.target.value)
                  }}
                  onFocus={(e) => {
                    if (e.target.value === tokenDetailsDefaults.symbol) setSymbol('')
                  }}
                  onBlur={(e) => {
                    if (e.target.value === '') setSymbol(tokenDetailsDefaults.symbol)
                  }}
                  onKeyDown={handleKeyPress}
                />
                Symbol
              </label>
            </div>

            <div className='tokenDecimals'>
              <label className='tokenInputLabel'>
                <input
                  className={`tokenInput ${
                    decimals === tokenDetailsDefaults.decimals ? 'tokenInputDim' : ''
                  }`}
                  value={decimals}
                  disabled={isSaving}
                  spellCheck={false}
                  onChange={(e) => {
                    if (!e.target.value) return setDecimals('')
                    if (e.target.value.length > 2) return e.preventDefault()

                    const decimals = parseInt(e.target.value)
                    if (!Number.isInteger(decimals)) return e.preventDefault()

                    setDecimals(decimals)
                  }}
                  onFocus={(e) => {
                    if (e.target.value === tokenDetailsDefaults.decimals) setDecimals('')
                  }}
                  onBlur={(e) => {
                    if (e.target.value === '') setDecimals(tokenDetailsDefaults.decimals)
                  }}
                  onKeyDown={handleKeyPress}
                />
                Decimals
              </label>
            </div>
          </div>

          <div className='tokenRow'>
            <div className='tokenLogoUri'>
              <label className='tokenInputLabel'>
                <input
                  className={`tokenInput ${logoUri === tokenDetailsDefaults.logoURI ? 'tokenInputDim' : ''}`}
                  value={logoUri}
                  disabled={isSaving}
                  spellCheck={false}
                  onChange={(e) => {
                    setLogoUri(e.target.value)
                  }}
                  onFocus={(e) => {
                    if (e.target.value === tokenDetailsDefaults.logoURI) setLogoUri('')
                  }}
                  onBlur={(e) => {
                    if (e.target.value === '') setLogoUri(tokenDetailsDefaults.logoURI)
                  }}
                  onKeyDown={handleKeyPress}
                />
                Logo URI
              </label>
            </div>
          </div>
          <div className='tokenRow'>
            {newTokenReady ? (
              <button
                type='button'
                className='addTokenSubmit addTokenSubmitEnabled'
                disabled={isSaving}
                onClick={saveAndClose}
              >
                {isEdit ? 'Save' : 'Add Token'}
              </button>
            ) : (
              <button type='button' className='addTokenSubmit' disabled>
                Fill in Token Details
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const AddToken = ({ data }) => {
  const { address, chain, error, tokenData, isEdit, requestReference } = data?.notifyData || {}

  if (!chain) return <SelectChain />
  if (!address) return <EnterAddress key={chain.id} chain={chain} />
  if (error) return <TokenError text={error} onContinue={() => navForward({ address, chain })} />

  return (
    <TokenDetailsForm
      key={`${chain.id}:${address}:${Boolean(isEdit)}`}
      chain={chain}
      req={requestReference}
      tokenData={{ ...tokenData, address }}
      isEdit={isEdit}
    />
  )
}

export default AddToken
