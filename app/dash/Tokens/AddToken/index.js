import { isValidAddress } from '@ethereumjs/util'
import { Component, useEffect, useRef, useState } from 'react'
import Restore from 'react-restore'
import Icon from '../../../../resources/Components/Icon'
import RingIcon from '../../../../resources/Components/RingIcon'
import link from '../../../../resources/link'

const COPY = Object.freeze({
  addAnyway: 'Add anyway',
  addToken: 'Add token',
  addingToken: 'Adding token…',
  cancel: 'Cancel',
  checkingToken: 'Checking token…',
  completeTokenDetails: 'Complete token details',
  continue: 'Continue',
  decimals: 'Decimals',
  invalidAddress: 'Enter a valid token contract address.',
  logoUri: 'Logo URI',
  lookupFailed: 'Token details could not be verified.',
  noEnabledNetworks: 'No enabled networks',
  openNetworks: 'Open Networks',
  save: 'Save',
  saveFailed: 'Token could not be saved. Check the details and try again.',
  selectNetwork: 'Select a network',
  symbol: 'Symbol',
  tokenAddress: 'Token contract address',
  tokenDetails: 'Token details',
  tokenName: 'Token name'
})

const navForward = async (notifyData) =>
  link.send('nav:forward', 'dash', {
    view: 'tokens',
    data: {
      notify: 'addToken',
      notifyData
    }
  })

const navBack = async (steps = 1) => link.send('nav:back', 'dash', steps)

const preserveRequestReference = (notifyData, requestReference) =>
  requestReference ? { ...notifyData, requestReference } : notifyData

class TokenNetworkLabelComponent extends Component {
  render() {
    const network = this.store('main.networks.ethereum', this.props.chain.id) || {}
    const name = this.props.chain.name || network.name
    const color =
      this.props.chain.color || this.store('main.networksMeta.ethereum', this.props.chain.id, 'primaryColor')

    if (!name) return null

    return (
      <div className='newTokenNetwork' style={{ color: color ? `var(--${color})` : undefined }}>
        {`On ${name}`}
      </div>
    )
  }
}

const TokenNetworkLabel = Restore.connect(TokenNetworkLabelComponent)

const TokenError = ({ text, onContinue }) => {
  const handledRef = useRef(false)
  const handleOnce = (action) => {
    if (handledRef.current) return
    handledRef.current = true
    action()
  }

  return (
    <div className='newTokenView cardShow'>
      <div className='newTokenFormInner newTokenError'>
        <h1 className='newTokenTitle'>{text}</h1>
        <div className='newTokenActions'>
          <button
            type='button'
            className='wrenControl wrenControlSecondary'
            onClick={() => handleOnce(() => navBack())}
          >
            {COPY.cancel}
          </button>
          {text === COPY.lookupFailed ? (
            <button
              type='button'
              className='wrenControl wrenControlPrimary'
              onClick={() =>
                handleOnce(() => {
                  navBack()
                  onContinue()
                })
              }
            >
              {COPY.addAnyway}
            </button>
          ) : null}
        </div>
      </div>
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
          notifyData: preserveRequestReference(
            { chain: { id: chainId, color: primaryColor, name: chain.name } },
            this.props.requestReference
          )
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
        <div className='newTokenFormInner'>
          <h1 className='newTokenTitle'>{COPY.selectNetwork}</h1>
          <div className='newTokenChainSelectChain'>
            {activeChains.length ? (
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
                      <span className='originChainItemIcon'>
                        <RingIcon
                          color={primaryColor ? `var(--${primaryColor})` : 'var(--moon)'}
                          img={icon}
                          small={true}
                        />
                      </span>
                      <span>{chain.name}</span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className='newTokenEmpty' role='status'>
                {COPY.noEnabledNetworks}
              </div>
            )}
          </div>
          <div className='newTokenChainSelectFooter'>
            <button
              type='button'
              className='newTokenEnableChainLink wrenControl wrenControlSecondary'
              disabled={this.state.selectingChainId !== null}
              onClick={() => this.openChains()}
            >
              {COPY.openNetworks}
            </button>
          </div>
        </div>
      </div>
    )
  }
}

const SelectChain = Restore.connect(AddTokenChainScreenComponent)

const EnterAddress = ({ chain, requestReference }) => {
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

  const resolveTokenData = async () => {
    setFetching(true)

    let tokenData = {}
    try {
      tokenData = (await link.invoke('tray:getTokenDetails', contractAddress, chain.id)) || {}
    } catch {
      tokenData = {}
    }
    if (!mountedRef.current) return

    const error = tokenData.totalSupply ? null : COPY.lookupFailed
    return navForward(
      preserveRequestReference({ error, tokenData, address: contractAddress, chain }, requestReference)
    )
  }

  const submit = () => {
    if (submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)

    if (!isValidAddress(contractAddress))
      return navForward(
        preserveRequestReference(
          {
            error: COPY.invalidAddress,
            address: contractAddress,
            chain
          },
          requestReference
        )
      )

    resolveTokenData()
  }

  return (
    <div className='newTokenView cardShow'>
      <div className='newTokenFormInner'>
        <h1 className='newTokenTitle'>{COPY.addToken}</h1>
        {isFetching ? (
          <div className='newTokenLoading' role='status'>
            <div className='signerLoading'>
              <div className='signerLoadingLoader' />
            </div>
            <span>{COPY.checkingToken}</span>
          </div>
        ) : (
          <form
            className='newTokenForm'
            onSubmit={(event) => {
              event.preventDefault()
              submit()
            }}
          >
            <TokenNetworkLabel chain={chain} />
            <label className='tokenInputLabel' htmlFor='newTokenAddress'>
              <span>{COPY.tokenAddress}</span>
              <input
                id='newTokenAddress'
                className='tokenInput tokenInputAddress wrenInput'
                value={contractAddress}
                disabled={isSubmitting}
                spellCheck={false}
                autoFocus={true}
                placeholder='0x…'
                required
                onChange={(e) => {
                  if (e.target.value.length > 42) {
                    e.preventDefault()
                  } else {
                    setAddress(e.target.value)
                  }
                }}
              />
            </label>
            <div className='newTokenActions'>
              <button
                type='submit'
                className='wrenControl wrenControlPrimary'
                disabled={isSubmitting || !contractAddress}
              >
                {COPY.continue}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

const TokenDetailsForm = ({ req, chain, tokenData, isEdit }) => {
  const [name, setName] = useState(tokenData.name || '')
  const [symbol, setSymbol] = useState(tokenData.symbol || '')
  const [decimals, setDecimals] = useState(
    Number.isInteger(tokenData.decimals) ? String(tokenData.decimals) : ''
  )
  const [logoUri, setLogoUri] = useState(tokenData.logoURI || '')
  const [isSaving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const savingRef = useRef(false)
  const mountedRef = useRef(true)

  const { address } = tokenData
  const parsedDecimals = decimals === '' ? Number.NaN : Number(decimals)
  const validDecimals = Number.isInteger(parsedDecimals) && parsedDecimals >= 0 && parsedDecimals <= 255

  const newTokenReady =
    Boolean(name.trim()) && Boolean(symbol.trim()) && Number.isInteger(chain.id) && validDecimals

  const saveAndClose = async () => {
    if (!newTokenReady || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setSaveError('')

    const token = {
      name: name.trim(),
      symbol: symbol.trim(),
      chainId: chain.id,
      address,
      decimals: parsedDecimals,
      logoURI: logoUri.trim()
    }

    const backSteps = isEdit ? 2 : 4

    let result
    try {
      result = await link.invoke('tokens:save', token, req)
    } catch {
      result = null
    }
    if (!mountedRef.current) return

    if (!result?.success) {
      savingRef.current = false
      setSaving(false)
      setSaveError(COPY.saveFailed)
      return
    }

    navBack(backSteps)
    link.send('nav:forward', 'dash', {
      view: 'tokens',
      data: {}
    })
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  return (
    <div className='newTokenView cardShow' onMouseDown={(e) => e.stopPropagation()}>
      <div className='newTokenFormInner'>
        <h1 className='newTokenTitle' data-testid='addTokenFormTitle'>
          {COPY.tokenDetails}
        </h1>
        <div className='newTokenContext'>
          <div className='newTokenChainAddress'>
            {address.substring(0, 10)}
            <Icon name='ellipsis' size={14} />
            {address.substring(address.length - 8)}
          </div>
          <TokenNetworkLabel chain={chain} />
        </div>
        <form
          className='addToken'
          onSubmit={(event) => {
            event.preventDefault()
            saveAndClose()
          }}
        >
          <label className='tokenInputLabel' htmlFor='tokenName'>
            <span>{COPY.tokenName}</span>
            <input
              id='tokenName'
              className='tokenInput wrenInput'
              value={name}
              disabled={isSaving}
              spellCheck={false}
              placeholder='Token name'
              required
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className='tokenFieldRow'>
            <label className='tokenInputLabel' htmlFor='tokenSymbol'>
              <span>{COPY.symbol}</span>
              <input
                id='tokenSymbol'
                className='tokenInput wrenInput'
                value={symbol}
                disabled={isSaving}
                spellCheck={false}
                maxLength={10}
                placeholder='e.g. USDC'
                required
                onChange={(e) => setSymbol(e.target.value)}
              />
            </label>
            <label className='tokenInputLabel' htmlFor='tokenDecimals'>
              <span>{COPY.decimals}</span>
              <input
                id='tokenDecimals'
                aria-invalid={decimals !== '' && !validDecimals ? 'true' : undefined}
                className='tokenInput wrenInput'
                value={decimals}
                disabled={isSaving}
                inputMode='numeric'
                spellCheck={false}
                placeholder='e.g. 6'
                required
                onChange={(e) => {
                  const value = e.target.value
                  if (!/^\d{0,3}$/.test(value)) return
                  if (value && Number(value) > 255) return
                  setDecimals(value)
                }}
              />
            </label>
          </div>
          <label className='tokenInputLabel' htmlFor='tokenLogoUri'>
            <span>{COPY.logoUri}</span>
            <input
              id='tokenLogoUri'
              className='tokenInput wrenInput'
              value={logoUri}
              disabled={isSaving}
              spellCheck={false}
              placeholder='https://…'
              onChange={(e) => setLogoUri(e.target.value)}
            />
          </label>
          {saveError ? (
            <div className='newTokenSaveError' role='alert'>
              {saveError}
            </div>
          ) : null}
          <div className='newTokenActions'>
            <button
              type='submit'
              className='wrenControl wrenControlPrimary'
              disabled={!newTokenReady || isSaving}
            >
              {isSaving
                ? COPY.addingToken
                : newTokenReady
                  ? isEdit
                    ? COPY.save
                    : COPY.addToken
                  : COPY.completeTokenDetails}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const AddToken = ({ data }) => {
  const { address, chain, error, tokenData, isEdit, requestReference } = data?.notifyData || {}

  if (!chain) return <SelectChain requestReference={requestReference} />
  if (!address) return <EnterAddress key={chain.id} chain={chain} requestReference={requestReference} />
  if (error)
    return (
      <TokenError
        text={error}
        onContinue={() => navForward(preserveRequestReference({ address, chain }, requestReference))}
      />
    )

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
