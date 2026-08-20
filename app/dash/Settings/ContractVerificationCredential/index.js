import { Component, createRef } from 'react'

import link from '../../../../resources/link'

const emptyCredential = { available: false, configured: false, backend: 'unsupported' }

export class ContractVerificationCredential extends Component {
  constructor(props) {
    super(props)
    this.apiKeyRef = createRef()
    this.state = {
      credential: emptyCredential,
      loading: true,
      busy: false,
      keyReady: false,
      error: '',
      notice: ''
    }
  }

  componentDidMount() {
    this.mounted = true
    void this.loadStatus()
  }

  componentWillUnmount() {
    this.mounted = false
    if (this.apiKeyRef.current) this.apiKeyRef.current.value = ''
  }

  async loadStatus() {
    try {
      const result = await link.invoke('contractVerification:credentialStatus')
      if (!this.mounted) return
      if (!result?.success || !result.credential) throw new Error('status unavailable')
      this.setState({ credential: result.credential, loading: false, error: '' })
    } catch {
      if (this.mounted) {
        this.setState({
          credential: emptyCredential,
          loading: false,
          error: 'Credential status unavailable.'
        })
      }
    }
  }

  async save() {
    if (this.state.busy || !this.state.keyReady || !this.apiKeyRef.current) return
    let apiKey = this.apiKeyRef.current.value
    this.apiKeyRef.current.value = ''
    this.setState({ busy: true, keyReady: false, error: '', notice: '' })
    try {
      const result = await link.invoke('contractVerification:saveCredential', apiKey)
      apiKey = ''
      if (!this.mounted) return
      if (!result?.success) throw new Error('save unavailable')
      this.setState({
        credential: result.credential,
        busy: false,
        notice: 'Etherscan API key saved.',
        error: ''
      })
    } catch {
      apiKey = ''
      if (this.mounted) this.setState({ busy: false, error: 'API key could not be saved.' })
    }
  }

  async remove() {
    if (this.state.busy) return
    this.setState({ busy: true, error: '', notice: '' })
    try {
      const result = await link.invoke('contractVerification:removeCredential')
      if (!this.mounted) return
      if (!result?.success) throw new Error('remove unavailable')
      this.setState({
        credential: result.credential,
        busy: false,
        notice: 'Etherscan API key removed.',
        error: ''
      })
    } catch {
      if (this.mounted) this.setState({ busy: false, error: 'API key could not be removed.' })
    }
  }

  render() {
    const { credential, loading, busy, keyReady, error, notice } = this.state
    const unavailable = !loading && !credential.available
    return (
      <div className='signerPermission localSetting localSettingExplained contractVerificationCredential'>
        <div className='signerPermissionControls contractVerificationCredentialControls'>
          <div className='contractVerificationCredentialIdentity'>
            <div className='signerPermissionSetting'>Etherscan API key</div>
            <div className='contractVerificationCredentialStatus'>
              {loading
                ? 'Checking secure storage…'
                : unavailable
                  ? 'Secure storage unavailable'
                  : credential.configured
                    ? 'Stored securely'
                    : 'Not configured'}
            </div>
          </div>
          {credential.available || credential.configured ? (
            <div className='contractVerificationCredentialActions'>
              {credential.available ? (
                <>
                  <input
                    ref={this.apiKeyRef}
                    type='password'
                    className='wrenInput contractVerificationCredentialInput'
                    aria-label={credential.configured ? 'Replace Etherscan API key' : 'Etherscan API key'}
                    autoComplete='off'
                    spellCheck='false'
                    minLength='16'
                    maxLength='128'
                    disabled={busy}
                    placeholder={credential.configured ? 'New key' : 'API key'}
                    onInput={(event) =>
                      this.setState({ keyReady: /^[A-Za-z0-9_-]{16,128}$/u.test(event.currentTarget.value) })
                    }
                  />
                  <button
                    type='button'
                    className='wrenControl wrenControlGhost'
                    disabled={busy || !keyReady}
                    onClick={() => this.save()}
                  >
                    {busy ? 'Saving…' : credential.configured ? 'Replace' : 'Save'}
                  </button>
                </>
              ) : null}
              {credential.configured ? (
                <button
                  type='button'
                  className='wrenControl wrenControlGhost'
                  disabled={busy}
                  onClick={() => this.remove()}
                >
                  Remove
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className='signerPermissionDetails'>
          Used only for direct Etherscan verification when Sourcify forwarding is unavailable. Stored with OS
          credential protection on this device. Not included in profile backups; re-enter it after a restore.
        </div>
        <div className='contractVerificationCredentialMessage' role='status' aria-live='polite'>
          {notice}
        </div>
        {error ? (
          <div className='contractVerificationCredentialError' role='alert'>
            {error}
          </div>
        ) : null}
      </div>
    )
  }
}

export default ContractVerificationCredential
