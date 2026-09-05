import { isValidAddress } from '@ethereumjs/util'
import { Component, useEffect, useRef, useState } from 'react'
import Restore from 'react-restore'
import ChainIdentityMark from '../../../../resources/Components/ChainIdentityMark'
import Icon from '../../../../resources/Components/Icon'
import link from '../../../../resources/link'
import { safeNetworkMetadata } from '../../../../resources/domain/networkMetadata'

const COPY = Object.freeze({
  addToken: 'Add token',
  addingToken: 'Adding token…',
  checkingToken: 'Checking token…',
  completeTokenDetails: 'Complete token details',
  decimals: 'Decimals',
  invalidAddress: 'Enter a valid token contract address.',
  logoUri: 'Logo URI',
  lookupFailed: 'Token details could not be verified.',
  lookupFailedManual: 'Token details could not be verified. Enter the details manually.',
  noEnabledNetworks: 'No enabled networks',
  openNetworks: 'Open networks',
  save: 'Save',
  saveFailed: 'Token could not be saved. Check the details and try again.',
  selectNetwork: 'Select a network',
  symbol: 'Symbol',
  tokenAddress: 'Token contract address',
  tokenDetected: 'Token details detected.',
  tokenDetails: 'Token details',
  tokenName: 'Token name'
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
            {
              chain: { id: chainId, color: primaryColor, name: chain.name }
            },
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
                  const { primaryColor, icon } = safeNetworkMetadata(
                    this.store('main.networksMeta.ethereum', chainId),
                    chain
                  )

                  return (
                    <button
                      type='button'
                      className='originChainItem'
                      key={chainId}
                      disabled={this.state.selectingChainId !== null}
                      onClick={() => this.selectChain(chain, primaryColor)}
                    >
                      <span className='originChainItemIcon'>
                        <ChainIdentityMark
                          chainId={chainId}
                          icon={icon}
                          isTestnet={Boolean(chain.isTestnet)}
                          primaryColor={primaryColor}
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

const TOKEN_LOOKUP_DELAY = 350

const hasVerifiedTokenData = (tokenData) => Boolean(tokenData?.totalSupply)

const TokenDetailsForm = ({ req, chain, tokenData = {}, isEdit = false, initialAddress = '', error }) => {
  const resolvedInitialAddress = initialAddress || tokenData.address || ''
  const initialLookupState = isEdit
    ? 'ready'
    : !resolvedInitialAddress || error === COPY.invalidAddress
      ? 'idle'
      : hasVerifiedTokenData(tokenData)
        ? 'ready'
        : 'manual'

  const [address, setAddress] = useState(resolvedInitialAddress)
  const [addressTouched, setAddressTouched] = useState(Boolean(error))
  const [lookupState, setLookupState] = useState(initialLookupState)
  const [lookupMessage, setLookupMessage] = useState(
    error === COPY.lookupFailed
      ? COPY.lookupFailedManual
      : error || (!isEdit && initialLookupState === 'ready' ? COPY.tokenDetected : '')
  )
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
  const lookupSequenceRef = useRef(0)
  const resolvedAddressRef = useRef(resolvedInitialAddress.trim())

  const normalizedAddress = address.trim()
  const parsedDecimals = decimals === '' ? Number.NaN : Number(decimals)
  const validDecimals = Number.isInteger(parsedDecimals) && parsedDecimals >= 0 && parsedDecimals <= 255
  const validAddress = isValidAddress(normalizedAddress)
  const invalidAddress =
    !isEdit &&
    Boolean(normalizedAddress) &&
    !validAddress &&
    (addressTouched || normalizedAddress.length >= 42 || error === COPY.invalidAddress)
  const detailsVisible = isEdit || lookupState === 'ready' || lookupState === 'manual'

  const newTokenReady =
    validAddress &&
    Boolean(name.trim()) &&
    Boolean(symbol.trim()) &&
    Number.isInteger(chain.id) &&
    validDecimals

  const saveAndClose = async () => {
    if (!newTokenReady || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setSaveError('')

    const token = {
      name: name.trim(),
      symbol: symbol.trim(),
      chainId: chain.id,
      address: normalizedAddress,
      decimals: parsedDecimals,
      logoURI: logoUri.trim()
    }

    const backSteps = isEdit ? 2 : 3

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
      lookupSequenceRef.current += 1
    }
  }, [])

  useEffect(() => {
    if (isEdit) return undefined

    const lookupAddress = address.trim()
    const sequence = ++lookupSequenceRef.current
    if (!lookupAddress || lookupAddress === resolvedAddressRef.current || !isValidAddress(lookupAddress)) {
      return undefined
    }

    const timer = setTimeout(async () => {
      setLookupState('checking')
      setLookupMessage('')

      let resolvedTokenData = {}
      try {
        resolvedTokenData = (await link.invoke('tray:getTokenDetails', lookupAddress, chain.id)) || {}
      } catch {
        resolvedTokenData = {}
      }
      if (!mountedRef.current || sequence !== lookupSequenceRef.current) return

      resolvedAddressRef.current = lookupAddress
      setName(resolvedTokenData.name || '')
      setSymbol(resolvedTokenData.symbol || '')
      setDecimals(Number.isInteger(resolvedTokenData.decimals) ? String(resolvedTokenData.decimals) : '')
      setLogoUri(resolvedTokenData.logoURI || '')

      if (hasVerifiedTokenData(resolvedTokenData)) {
        setLookupState('ready')
        setLookupMessage(COPY.tokenDetected)
      } else {
        setLookupState('manual')
        setLookupMessage(COPY.lookupFailedManual)
      }
    }, TOKEN_LOOKUP_DELAY)

    return () => clearTimeout(timer)
  }, [address, chain.id, isEdit])

  const updateAddress = (nextAddress) => {
    if (nextAddress.length > 42) return

    lookupSequenceRef.current += 1
    resolvedAddressRef.current = ''
    setAddress(nextAddress)
    setAddressTouched(false)
    setLookupState('idle')
    setLookupMessage('')
    setName('')
    setSymbol('')
    setDecimals('')
    setLogoUri('')
    setSaveError('')
  }

  const lookupPresentation = invalidAddress
    ? { icon: 'alert', message: COPY.invalidAddress, role: 'alert', tone: 'error' }
    : lookupState === 'checking'
      ? { icon: 'sync', message: COPY.checkingToken, role: 'status', tone: 'checking' }
      : lookupState === 'ready'
        ? { icon: 'check', message: lookupMessage, role: 'status', tone: 'ready' }
        : lookupState === 'manual' && lookupMessage
          ? { icon: 'alert', message: lookupMessage, role: 'alert', tone: 'error' }
          : null

  return (
    <div className='newTokenView cardShow' onMouseDown={(e) => e.stopPropagation()}>
      <div className='newTokenFormInner'>
        <h1 className='newTokenTitle' data-testid='addTokenFormTitle'>
          {isEdit ? COPY.tokenDetails : COPY.addToken}
        </h1>
        {isEdit ? (
          <div className='newTokenContext'>
            <div className='newTokenChainAddress'>
              {normalizedAddress.substring(0, 10)}
              <Icon name='ellipsis' size={14} />
              {normalizedAddress.substring(normalizedAddress.length - 8)}
            </div>
            <TokenNetworkLabel chain={chain} />
          </div>
        ) : null}
        <form
          className={isEdit ? 'addToken' : 'addToken newTokenCombinedForm'}
          onSubmit={(event) => {
            event.preventDefault()
            saveAndClose()
          }}
        >
          {!isEdit ? (
            <>
              <TokenNetworkLabel chain={chain} />
              <label className='tokenInputLabel' htmlFor='newTokenAddress'>
                <span>{COPY.tokenAddress}</span>
                <input
                  id='newTokenAddress'
                  aria-label={COPY.tokenAddress}
                  aria-describedby={lookupPresentation ? 'newTokenLookupStatus' : undefined}
                  aria-invalid={invalidAddress ? 'true' : undefined}
                  className='tokenInput tokenInputAddress wrenInput'
                  value={address}
                  disabled={isSaving}
                  spellCheck={false}
                  autoFocus={true}
                  maxLength={42}
                  placeholder='0x…'
                  required
                  onBlur={() => setAddressTouched(true)}
                  onChange={(event) => updateAddress(event.target.value)}
                />
              </label>
              {lookupPresentation ? (
                <div
                  id='newTokenLookupStatus'
                  className={`newTokenLookupStatus newTokenLookupStatus-${lookupPresentation.tone}`}
                  role={lookupPresentation.role}
                >
                  <Icon aria-hidden='true' name={lookupPresentation.icon} size={13} />
                  <span>{lookupPresentation.message}</span>
                </div>
              ) : null}
            </>
          ) : null}
          {detailsVisible ? (
            <section
              className='newTokenDetails'
              aria-labelledby={!isEdit ? 'newTokenDetailsTitle' : undefined}
            >
              {!isEdit ? (
                <h2 id='newTokenDetailsTitle' className='newTokenDetailsTitle'>
                  {COPY.tokenDetails}
                </h2>
              ) : null}
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
                  onChange={(event) => setName(event.target.value)}
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
                    onChange={(event) => setSymbol(event.target.value)}
                  />
                </label>
              </div>
              <details open={lookupState === 'manual' || !validDecimals || undefined}>
                <summary>Token metadata</summary>{' '}
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
                    onChange={(event) => {
                      const value = event.target.value
                      if (!/^\d{0,3}$/.test(value)) return
                      if (value && Number(value) > 255) return
                      setDecimals(value)
                    }}
                  />
                </label>
                <label className='tokenInputLabel' htmlFor='tokenLogoUri'>
                  <span>{COPY.logoUri}</span>
                  <input
                    id='tokenLogoUri'
                    className='tokenInput wrenInput'
                    value={logoUri}
                    disabled={isSaving}
                    spellCheck={false}
                    placeholder='https://…'
                    onChange={(event) => setLogoUri(event.target.value)}
                  />
                </label>
              </details>
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
            </section>
          ) : null}
        </form>
      </div>
    </div>
  )
}

const AddToken = ({ data }) => {
  const { address, chain, error, tokenData, isEdit, requestReference } = data?.notifyData || {}

  if (!chain) return <SelectChain requestReference={requestReference} />

  return (
    <TokenDetailsForm
      key={`${chain.id}:${isEdit ? address : 'new'}:${Boolean(isEdit)}`}
      chain={chain}
      error={error}
      initialAddress={address}
      req={requestReference}
      tokenData={{ ...tokenData, address }}
      isEdit={isEdit}
    />
  )
}

export default AddToken
