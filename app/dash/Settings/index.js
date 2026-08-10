import { Component, createRef } from 'react'
import Restore from 'react-restore'

import { WREN_LICENSE_URL } from '../../../resources/constants'
import link from '../../../resources/link'
import Dropdown from '../../../resources/Components/Dropdown'
import KeyboardShortcutConfigurator from '../../../resources/Components/KeyboardShortcutConfigurator'
import Toggle from '../../../resources/Components/Toggle'

import styled from 'styled-components'

const EditShortcut = styled.button`
  flex: none;
  min-height: 44px;
  min-width: 48px;
  padding: 0 8px;
  font-size: 12px;
`

const CompanionDetails = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
`

const CompanionIdentity = styled.div`
  color: var(--moon);
  font-family: 'FiraCode';
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const RevokeCompanion = styled.button`
  flex: none;
  min-height: 44px;
  font-size: 12px;
  margin-left: 16px;
`

const CompanionRevokeDialog = styled.div`
  margin-top: 12px;
  padding: 14px 16px 16px;
  border: 1px solid var(--wren-border-subtle);
  border-radius: var(--wren-radius-sm);
  background: var(--wren-bg-elevated);
`

const CompanionRevokeTitle = styled.h3`
  margin: 0;
  color: var(--wren-text-primary);
  font-family: var(--wren-font-ui);
  font-size: var(--wren-type-body);
  font-weight: 600;
  line-height: 20px;
`

const CompanionRevokeBody = styled.p`
  margin: 6px 0 0;
  color: var(--wren-text-secondary);
  font-family: var(--wren-font-ui);
  font-size: var(--wren-type-small);
  line-height: 18px;
`

const CompanionRevokeError = styled.div`
  margin-top: 8px;
  color: var(--wren-danger);
  font-family: var(--wren-font-ui);
  font-size: var(--wren-type-small);
  line-height: 18px;
`

const CompanionRevokeActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: var(--wren-space-2);
  margin-top: 12px;

  button {
    min-height: 44px;
    font-size: 12px;
  }
`

export class Settings extends Component {
  constructor(props, context) {
    super(props, context)
    const latticeEndpoint = context.store('main.latticeSettings.endpointCustom')
    const latticeEndpointMode = context.store('main.latticeSettings.endpointMode')
    this.revokeCancelRef = createRef()
    this.revokeTriggerRefs = {}
    this.resetTriggerRef = createRef()
    this.resetCancelRef = createRef()
    this.state = {
      latticeEndpoint,
      latticeEndpointMode,
      resetConfirm: false,
      instanceIdCopied: false,
      revokeCompanionConfirm: undefined,
      revokeCompanionPending: false,
      revokeCompanionError: ''
    }
  }

  componentDidMount() {
    this.mounted = true
  }

  componentWillUnmount() {
    this.mounted = false
    clearTimeout(this.instanceIdCopiedTimeout)
    clearTimeout(this.inputLatticeTimeout)
  }

  appInfo() {
    // TODO: move this to global passed over IPC
    // eslint-disable-next-line
    const appVersion = require('../../../package.json').version
    const instanceId = this.store('main.instanceId')
    return (
      <div className='appInfo'>
        <button
          type='button'
          className='appInfoLine appInfoLineInstanceId'
          onMouseLeave={(event) => {
            event.stopPropagation()
            event.preventDefault()
            this.setState({ instanceIdCopied: false })
          }}
          onClick={() => {
            clearTimeout(this.instanceIdCopiedTimeout)
            link.send('tray:clipboardData', instanceId)
            this.setState({ instanceIdCopied: true })
            this.instanceIdCopiedTimeout = setTimeout(() => this.setState({ instanceIdCopied: false }), 1800)
          }}
        >
          {this.state.instanceIdCopied ? (
            <span className='instanceIdCopied'>{'Instance ID Copied'}</span>
          ) : (
            instanceId
          )}
        </button>
        <div className='appInfoLine appInfoLineVersion'>{`v${appVersion}`}</div>
        <button
          type='button'
          className='appInfoViewLicense'
          onClick={() => link.send('tray:openExternal', WREN_LICENSE_URL)}
        >
          View License
        </button>
        <div className='appInfoLine appInfoLineReset'>
          {this.state.resetConfirm ? (
            <div
              className='appInfoLineResetConfirm'
              role='group'
              aria-labelledby='reset-app-title'
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  this.setState({ resetConfirm: false }, () => this.resetTriggerRef.current?.focus())
                }
              }}
            >
              <strong id='reset-app-title'>Reset Wren?</strong>
              <span>
                This removes local accounts, signers, networks, contacts, custom tokens, permissions, and
                settings from this device. This cannot be undone.
              </span>
              <span className='appInfoLineResetConfirmButtons'>
                <button
                  type='button'
                  ref={this.resetCancelRef}
                  className='wrenControl wrenControlSecondary'
                  onClick={() =>
                    this.setState({ resetConfirm: false }, () => this.resetTriggerRef.current?.focus())
                  }
                >
                  Cancel
                </button>
                <button
                  type='button'
                  className='wrenControl wrenControlDanger'
                  onClick={() => link.send('tray:resetAllSettings')}
                >
                  Reset Wren
                </button>
              </span>
            </div>
          ) : (
            <button
              type='button'
              ref={this.resetTriggerRef}
              className='appInfoLineResetButton'
              onClick={() =>
                this.setState({ resetConfirm: true }, () => this.resetCancelRef.current?.focus())
              }
            >
              Reset Wren
            </button>
          )}
        </div>
      </div>
    )
  }

  armCompanionRevocation(credential) {
    if (this.revokeCompanionPending) return
    this.setState(
      {
        revokeCompanionConfirm: credential.fingerprint,
        revokeCompanionPending: false,
        revokeCompanionError: ''
      },
      () => this.revokeCancelRef.current?.focus()
    )
  }

  cancelCompanionRevocation(fingerprint) {
    if (this.revokeCompanionPending) return
    this.setState(
      {
        revokeCompanionConfirm: undefined,
        revokeCompanionPending: false,
        revokeCompanionError: ''
      },
      () => this.revokeTriggerRefs[fingerprint]?.current?.focus()
    )
  }

  revokeCompanion(credential) {
    if (this.revokeCompanionPending || this.state.revokeCompanionPending) return

    this.revokeCompanionPending = true
    this.setState({ revokeCompanionPending: true, revokeCompanionError: '' })
    link.rpc('revokeExtensionCredential', credential.fingerprint, (error) => {
      this.revokeCompanionPending = false
      if (!this.mounted) return

      if (error) {
        this.setState({
          revokeCompanionPending: false,
          revokeCompanionError: 'Couldn\u2019t revoke pairing. The pairing is unchanged. Try again.'
        })
      } else {
        this.setState({
          revokeCompanionConfirm: undefined,
          revokeCompanionPending: false,
          revokeCompanionError: ''
        })
      }
    })
  }

  handleCompanionRevokeKeyDown(event, fingerprint) {
    if (event.key === 'Escape' && !this.state.revokeCompanionPending) {
      event.preventDefault()
      event.stopPropagation()
      this.cancelCompanionRevocation(fingerprint)
    }
  }

  inputLatticeEndpoint(e) {
    e.preventDefault()
    clearTimeout(this.inputLatticeTimeout)
    const value = e.target.value.replace(/\s+/g, '')
    this.setState({ latticeEndpoint: value })
    // TODO: Update to target specific Lattice device rather than global
    this.inputLatticeTimeout = setTimeout(
      () => link.send('tray:action', 'setLatticeEndpointCustom', value),
      1000
    )
  }

  render() {
    const summonShortcut = this.store('main.shortcuts.summon')
    const platform = this.store('platform')
    const companionCredentials = Object.values(this.store('main.extensionCredentials') || {}).sort(
      (left, right) => right.pairedAt - left.pairedAt
    )

    return (
      <div className='localSettings cardShow wrenSettings'>
        <div className='localSettingsWrap'>
          <section className='wrenSettingsSection' aria-labelledby='wren-settings-desktop'>
            <h2 id='wren-settings-desktop' className='wrenSettingsSectionTitle'>
              Desktop behavior
            </h2>
            <div className='signerPermission localSetting localSettingShortcut' style={{ zIndex: 214 }}>
              <div className='signerPermissionControls'>
                <div className='signerPermissionSetting settingsShortcutSetting'>
                  <span>Wallet shortcut</span>
                  {summonShortcut.configuring ? (
                    <EditShortcut
                      type='button'
                      className='wrenControl wrenControlGhost'
                      onClick={() => {
                        link.send('tray:action', 'setShortcut', 'summon', {
                          ...summonShortcut,
                          configuring: false
                        })
                      }}
                    >
                      Cancel
                    </EditShortcut>
                  ) : (
                    <EditShortcut
                      type='button'
                      className='wrenControl wrenControlGhost'
                      onClick={() => {
                        link.send('tray:action', 'setShortcut', 'summon', {
                          ...summonShortcut,
                          configuring: true
                        })
                      }}
                    >
                      Edit
                    </EditShortcut>
                  )}
                </div>

                <Toggle
                  checked={summonShortcut.enabled}
                  label='Enable wallet shortcut'
                  onChange={(enabled) => {
                    link.send('tray:action', 'setShortcut', 'summon', {
                      ...summonShortcut,
                      enabled
                    })
                  }}
                />
              </div>
              <div className='signerPermissionDetails'>
                <KeyboardShortcutConfigurator
                  actionText='open or dismiss Wren'
                  shortcut={summonShortcut}
                  shortcutName='summon'
                  platform={platform}
                />
              </div>
            </div>
            <div className='signerPermission localSetting' style={{ zIndex: 213 }}>
              <div className='signerPermissionControls'>
                <div className='signerPermissionSetting'>Auto-hide</div>
                <Toggle
                  checked={this.store('main.autohide')}
                  label='Auto-hide'
                  onChange={(enabled) => link.send('tray:action', 'setAutohide', enabled)}
                />
              </div>
              <div className='signerPermissionDetails'>
                <span>Hide Wren when it loses focus.</span>
              </div>
            </div>
            <div className='signerPermission localSetting' style={{ zIndex: 212 }}>
              <div className='signerPermissionControls'>
                <div className='signerPermissionSetting'>Run on startup</div>
                <Toggle
                  checked={this.store('main.launch')}
                  label='Run on startup'
                  onChange={() => link.send('tray:action', 'toggleLaunch')}
                />
              </div>
              <div className='signerPermissionDetails'>Start Wren when you sign in.</div>
            </div>
            <div className='signerPermission localSetting' style={{ zIndex: 211 }}>
              <div className='signerPermissionControls'>
                <div className='signerPermissionSetting'>Reveal from screen edge</div>
                <Toggle
                  checked={this.store('main.reveal')}
                  label='Reveal from screen edge'
                  onChange={() => link.send('tray:action', 'toggleReveal')}
                />
              </div>
              <div className='signerPermissionDetails'>{`Show Wren when the pointer rests at the display's ${this.store(
                'main.glideSide'
              )} edge.`}</div>
            </div>
            <div className='signerPermission localSetting' style={{ zIndex: 210 }}>
              <div className='signerPermissionControls'>
                <div className='signerPermissionSetting'>Wallet side</div>
                <Dropdown
                  label='Wallet side'
                  syncValue={this.store('main.glideSide')}
                  onChange={(value) => link.send('tray:action', 'setGlideSide', value)}
                  options={[
                    { text: 'Right', value: 'right' },
                    { text: 'Left', value: 'left' }
                  ]}
                />
              </div>
              <div className='signerPermissionDetails'>
                Choose the display edge that reveals Wren and where the wallet appears.
              </div>
            </div>

            {this.store('platform') === 'darwin' ? (
              <div className='signerPermission localSetting' style={{ zIndex: 209 }}>
                <div className='signerPermissionControls'>
                  <div className='signerPermissionSetting'>Display gas in menu bar</div>
                  <Toggle
                    checked={this.store('main.menubarGasPrice')}
                    label='Display gas in menu bar'
                    onChange={(enabled) => link.send('tray:action', 'setMenubarGasPrice', enabled)}
                  />
                </div>
                <div className='signerPermissionDetails'>Show the mainnet gas price in the menu bar.</div>
              </div>
            ) : null}
          </section>

          <section className='wrenSettingsSection' aria-labelledby='wren-settings-accounts'>
            <h2 id='wren-settings-accounts' className='wrenSettingsSectionTitle'>
              Accounts and signing
            </h2>

            <div className='signerPermission localSetting' style={{ zIndex: 207 }}>
              <div className='signerPermissionControls'>
                <div className='signerPermissionSetting'>Show account name with ENS</div>
                <Toggle
                  checked={this.store('main.showLocalNameWithENS')}
                  label='Show account name with ENS'
                  onChange={() => link.send('tray:action', 'toggleShowLocalNameWithENS')}
                />
              </div>
              <div className='signerPermissionDetails'>
                {'Show the local account name when ENS resolves.'}
              </div>
            </div>

            <div className='signerPermission localSetting' style={{ zIndex: 205 }}>
              <div className='signerPermissionControls'>
                <div className='signerPermissionSetting'>Trezor derivation</div>
                <Dropdown
                  label='Trezor derivation'
                  syncValue={this.store('main.trezor.derivation')}
                  onChange={(value) => link.send('tray:action', 'setTrezorDerivation', value)}
                  options={[
                    { text: 'Standard', value: 'standard' },
                    { text: 'Legacy', value: 'legacy' },
                    { text: 'Testnet', value: 'testnet' }
                  ]}
                />
              </div>
              <div className='signerPermissionDetails'>
                {'Choose the derivation path for connected Trezor devices.'}
              </div>
            </div>
            <div className='signerPermission localSetting' style={{ zIndex: 204 }}>
              <div className='signerPermissionControls'>
                <div className='signerPermissionSetting'>Ledger derivation</div>
                <Dropdown
                  label='Ledger derivation'
                  syncValue={this.store('main.ledger.derivation')}
                  onChange={(value) => link.send('tray:action', 'setLedgerDerivation', value)}
                  options={[
                    { text: 'Live', value: 'live' },
                    { text: 'Legacy', value: 'legacy' },
                    { text: 'Standard', value: 'standard' },
                    { text: 'Testnet', value: 'testnet' }
                  ]}
                />
              </div>
              <div className='signerPermissionDetails'>
                {'Choose the derivation path for connected Ledger devices.'}
              </div>
            </div>
            {this.store('main.ledger.derivation') === 'live' ? (
              <div className='signerPermission localSetting' style={{ zIndex: 203 }}>
                <div className='signerPermissionControls'>
                  <div className='signerPermissionSetting'>Ledger Live accounts</div>
                  <Dropdown
                    label='Ledger Live accounts'
                    syncValue={this.store('main.ledger.liveAccountLimit')}
                    onChange={(value) => link.send('tray:action', 'setLiveAccountLimit', value)}
                    options={[
                      { text: '5', value: 5 },
                      { text: '10', value: 10 },
                      { text: '20', value: 20 },
                      { text: '40', value: 40 }
                    ]}
                  />
                </div>
                <div className='signerPermissionDetails'>Choose how many Ledger Live accounts to derive.</div>
              </div>
            ) : null}
            <div className='signerPermission localSetting' style={{ zIndex: 202 }}>
              <div className='signerPermissionControls'>
                <div className='signerPermissionSetting'>Lattice derivation</div>
                <Dropdown
                  label='Lattice derivation'
                  syncValue={this.store('main.latticeSettings.derivation')}
                  onChange={(value) => link.send('tray:action', 'setLatticeDerivation', value)}
                  options={[
                    { text: 'Standard', value: 'standard' },
                    { text: 'Legacy', value: 'legacy' },
                    { text: 'Live', value: 'live' }
                  ]}
                />
              </div>
              <div className='signerPermissionDetails'>
                {'Choose the derivation path for connected Lattice devices.'}
              </div>
            </div>
            <div className='signerPermission localSetting' style={{ zIndex: 201 }}>
              <div className='signerPermissionControls'>
                <div className='signerPermissionSetting'>Lattice accounts</div>
                <Dropdown
                  label='Lattice accounts'
                  syncValue={this.store('main.latticeSettings.accountLimit')}
                  onChange={(value) => link.send('tray:action', 'setLatticeAccountLimit', value)}
                  options={[
                    { text: '5', value: 5 },
                    { text: '10', value: 10 },
                    { text: '20', value: 20 },
                    { text: '40', value: 40 }
                  ]}
                />
              </div>
              <div className='signerPermissionDetails'>Choose how many Lattice accounts to derive.</div>
            </div>
            <div className='signerPermission localSetting' style={{ zIndex: 200 }}>
              <div className='signerPermissionControls'>
                <div className='signerPermissionSetting'>Lattice relay</div>
                <Dropdown
                  label='Lattice relay'
                  syncValue={this.store('main.latticeSettings.endpointMode')}
                  onChange={(value) => {
                    link.send('tray:action', 'setLatticeEndpointMode', value)
                    this.setState({ latticeEndpointMode: value })
                  }}
                  options={[
                    { text: 'Default', value: 'default' },
                    { text: 'Custom', value: 'custom' }
                  ]}
                />
              </div>
              <div
                className={
                  this.state.latticeEndpointMode === 'custom'
                    ? 'connectionCustomInput connectionCustomInputOn'
                    : 'connectionCustomInput'
                }
              >
                <input
                  className='wrenInput'
                  disabled={this.state.latticeEndpointMode !== 'custom'}
                  aria-label='Custom Lattice relay'
                  placeholder={'Custom relay'}
                  value={this.state.latticeEndpoint}
                  onChange={(e) => this.inputLatticeEndpoint(e)}
                />
              </div>
            </div>

            <div className='signerPermission localSetting' style={{ zIndex: 199 }}>
              <div className='signerPermissionControls'>
                <div className='signerPermissionSetting'>Lock hot signers when</div>
                <Dropdown
                  label='Lock hot signers when'
                  syncValue={this.store('main.accountCloseLock')}
                  onChange={(value) => link.send('tray:action', 'setAccountCloseLock', value)}
                  options={[
                    { text: 'Close', value: true },
                    { text: 'Quit', value: false }
                  ]}
                />
              </div>
              <div className='signerPermissionDetails'>Choose when Wren relocks hot signers.</div>
            </div>
          </section>

          {companionCredentials.length > 0 ? (
            <section className='wrenSettingsSection' aria-labelledby='wren-settings-companions'>
              <h2 id='wren-settings-companions' className='wrenSettingsSectionTitle'>
                Browser companions
              </h2>
              {companionCredentials.map((credential, index) => {
                const confirm = this.state.revokeCompanionConfirm === credential.fingerprint
                if (!this.revokeTriggerRefs[credential.fingerprint]) {
                  this.revokeTriggerRefs[credential.fingerprint] = createRef()
                }
                const dialogSuffix = String(credential.fingerprint).replace(/[^a-zA-Z0-9_-]/g, '')
                const titleId = `revoke-companion-title-${dialogSuffix}`
                const bodyId = `revoke-companion-body-${dialogSuffix}`
                return (
                  <div
                    className='signerPermission localSetting'
                    key={credential.fingerprint}
                    style={{ zIndex: 198 - index }}
                  >
                    <div className='signerPermissionControls'>
                      <CompanionDetails>
                        <div className='signerPermissionSetting'>{`${credential.browser} companion`}</div>
                        <CompanionIdentity>{credential.extensionId}</CompanionIdentity>
                        <CompanionIdentity>{credential.fingerprint}</CompanionIdentity>
                      </CompanionDetails>
                      {!confirm ? (
                        <RevokeCompanion
                          ref={this.revokeTriggerRefs[credential.fingerprint]}
                          type='button'
                          className='wrenControl wrenControlGhost'
                          onClick={() => this.armCompanionRevocation(credential)}
                        >
                          Revoke
                        </RevokeCompanion>
                      ) : null}
                    </div>
                    <div className='signerPermissionDetails'>
                      Remove this pairing. A new code confirmation is required on reconnect.
                    </div>
                    {confirm ? (
                      <CompanionRevokeDialog
                        role='alertdialog'
                        aria-labelledby={titleId}
                        aria-describedby={bodyId}
                        aria-busy={this.state.revokeCompanionPending}
                        onKeyDown={(event) =>
                          this.handleCompanionRevokeKeyDown(event, credential.fingerprint)
                        }
                      >
                        <CompanionRevokeTitle id={titleId}>
                          {`Revoke ${credential.browser} pairing?`}
                        </CompanionRevokeTitle>
                        <CompanionRevokeBody id={bodyId}>
                          {`This disconnects the ${credential.browser} Companion pairing from Wren. A new pairing code will be required to connect it again.`}
                        </CompanionRevokeBody>
                        {this.state.revokeCompanionError ? (
                          <CompanionRevokeError role='alert'>
                            {this.state.revokeCompanionError}
                          </CompanionRevokeError>
                        ) : null}
                        <CompanionRevokeActions>
                          <button
                            type='button'
                            ref={this.revokeCancelRef}
                            className='wrenControl wrenControlGhost'
                            disabled={this.state.revokeCompanionPending}
                            onClick={() => this.cancelCompanionRevocation(credential.fingerprint)}
                          >
                            Cancel
                          </button>
                          <button
                            type='button'
                            className='wrenControl wrenControlDanger'
                            disabled={this.state.revokeCompanionPending}
                            onClick={() => this.revokeCompanion(credential)}
                          >
                            {this.state.revokeCompanionPending ? 'Revoking pairing\u2026' : 'Confirm revoke'}
                          </button>
                        </CompanionRevokeActions>
                      </CompanionRevokeDialog>
                    ) : null}
                  </div>
                )
              })}
            </section>
          ) : null}
          <section className='wrenSettingsSection' aria-labelledby='wren-settings-about'>
            <h2 id='wren-settings-about' className='wrenSettingsSectionTitle'>
              About
            </h2>
            {this.appInfo()}
          </section>
        </div>
      </div>
    )
  }
}

export default Restore.connect(Settings)
