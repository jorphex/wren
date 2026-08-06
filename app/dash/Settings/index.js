import { Component } from 'react'
import Restore from 'react-restore'

import link from '../../../resources/link'
import Dropdown from '../../../resources/Components/Dropdown'
import KeyboardShortcutConfigurator from '../../../resources/Components/KeyboardShortcutConfigurator'
import Toggle from '../../../resources/Components/Toggle'

import styled from 'styled-components'

const EditShortcut = styled.button`
  appearance: none;
  position: absolute;
  top: 1px;
  bottom: 0px;
  left: calc(100% + 10px);
  background: var(--ghostC);
  height: 20px;
  width: 60px;
  padding: 0;
  color: var(--wren-text-primary);
  font-family: inherit;
  border-radius: 10px;
  border: 1px solid var(--wren-border-subtle);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  text-transform: uppercase;
  font-size: 10px;
  font-weight: 500;
  &:hover {
    color: var(--wren-text-primary);
    background: var(--wren-surface-hover);
  }
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
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const RevokeCompanion = styled.button`
  appearance: none;
  color: ${({ $confirm }) => ($confirm ? 'var(--bad)' : 'var(--moon)')};
  font-family: inherit;
  padding: 8px;
  background: transparent;
  border: 0;
  border-radius: var(--wren-radius-sm);
  cursor: pointer;
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.6px;
  margin-left: 16px;
  text-transform: uppercase;
  &:hover {
    background: ${({ $confirm }) => ($confirm ? 'var(--wren-danger-soft)' : 'var(--wren-surface-hover)')};
  }
`

export class Settings extends Component {
  constructor(props, context) {
    super(props, context)
    const latticeEndpoint = context.store('main.latticeSettings.endpointCustom')
    const latticeEndpointMode = context.store('main.latticeSettings.endpointMode')
    this.state = {
      latticeEndpoint,
      latticeEndpointMode,
      resetConfirm: false,
      revokeCompanionConfirm: undefined
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
      <div className={'localSettings cardShow'}>
        <div className='localSettingsWrap'>
          <div className='signerPermission localSetting' style={{ zIndex: 214 }}>
            <div className='signerPermissionControls'>
              <div className='signerPermissionSetting'>
                <span style={{ position: 'relative' }}>
                  Summon Shortcut
                  <div>
                    {summonShortcut.configuring ? (
                      <EditShortcut
                        type='button'
                        onClick={() => {
                          link.send('tray:action', 'setShortcut', 'summon', {
                            ...summonShortcut,
                            configuring: false
                          })
                        }}
                      >
                        cancel
                      </EditShortcut>
                    ) : (
                      <EditShortcut
                        type='button'
                        onClick={() => {
                          link.send('tray:action', 'setShortcut', 'summon', {
                            ...summonShortcut,
                            configuring: true
                          })
                        }}
                      >
                        edit
                      </EditShortcut>
                    )}
                  </div>
                </span>
              </div>

              <Toggle
                checked={summonShortcut.enabled}
                label='Enable summon shortcut'
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
                actionText='summon Wren'
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
              <span>Hide Wren on loss of focus</span>
            </div>
          </div>
          <div className='signerPermission localSetting' style={{ zIndex: 212 }}>
            <div className='signerPermissionControls'>
              <div className='signerPermissionSetting'>Run on Startup</div>
              <Toggle
                checked={this.store('main.launch')}
                label='Run on startup'
                onChange={() => link.send('tray:action', 'toggleLaunch')}
              />
            </div>
            <div className='signerPermissionDetails'>Run Wren when your computer starts</div>
          </div>
          <div className='signerPermission localSetting' style={{ zIndex: 211 }}>
            <div className='signerPermissionControls'>
              <div className='signerPermissionSetting'>Glide</div>
              <Toggle
                checked={this.store('main.reveal')}
                label='Glide'
                onChange={() => link.send('tray:action', 'toggleReveal')}
              />
            </div>
            <div className='signerPermissionDetails'>{`Mouse to display's ${this.store(
              'main.glideSide'
            )} edge to summon Wren`}</div>
          </div>
          <div className='signerPermission localSetting' style={{ zIndex: 210 }}>
            <div className='signerPermissionControls'>
              <div className='signerPermissionSetting'>Glide Edge</div>
              <Dropdown
                label='Glide edge'
                syncValue={this.store('main.glideSide')}
                onChange={(value) => link.send('tray:action', 'setGlideSide', value)}
                options={[
                  { text: 'Right', value: 'right' },
                  { text: 'Left', value: 'left' }
                ]}
              />
            </div>
            <div className='signerPermissionDetails'>Choose which display edge summons Wren</div>
          </div>

          {this.store('platform') === 'darwin' ? (
            <div className='signerPermission localSetting' style={{ zIndex: 209 }}>
              <div className='signerPermissionControls'>
                <div className='signerPermissionSetting'>Display Gas in Menubar</div>
                <Toggle
                  checked={this.store('main.menubarGasPrice')}
                  label='Display gas in menubar'
                  onChange={(enabled) => link.send('tray:action', 'setMenubarGasPrice', enabled)}
                />
              </div>
              <div className='signerPermissionDetails'>Show mainnet gas price (Gwei) in menubar</div>
            </div>
          ) : null}

          <div className='signerPermission localSetting' style={{ zIndex: 207 }}>
            <div className='signerPermissionControls'>
              <div className='signerPermissionSetting'>Show Account Name with ENS</div>
              <Toggle
                checked={this.store('main.showLocalNameWithENS')}
                label='Show account name with ENS'
                onChange={() => link.send('tray:action', 'toggleShowLocalNameWithENS')}
              />
            </div>
            <div className='signerPermissionDetails'>{'Show local account name when ENS is resolved'}</div>
          </div>

          <div className='signerPermission localSetting' style={{ zIndex: 205 }}>
            <div className='signerPermissionControls'>
              <div className='signerPermissionSetting'>Trezor Derivation</div>
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
            <div className='signerPermissionDetails'>{'Derivation path for connected Trezor devices'}</div>
          </div>
          <div className='signerPermission localSetting' style={{ zIndex: 204 }}>
            <div className='signerPermissionControls'>
              <div className='signerPermissionSetting'>Ledger Derivation</div>
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
            <div className='signerPermissionDetails'>{'Derivation path for connected Ledger devices'}</div>
          </div>
          {this.store('main.ledger.derivation') === 'live' ? (
            <div className='signerPermission localSetting' style={{ zIndex: 203 }}>
              <div className='signerPermissionControls'>
                <div className='signerPermissionSetting'>Ledger Live Accounts</div>
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
              <div className='signerPermissionDetails'>The number of live accounts to derive</div>
            </div>
          ) : null}
          <div className='signerPermission localSetting' style={{ zIndex: 202 }}>
            <div className='signerPermissionControls'>
              <div className='signerPermissionSetting'>Lattice Derivation</div>
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
            <div className='signerPermissionDetails'>{'Derivation path for connected Lattice devices'}</div>
          </div>
          <div className='signerPermission localSetting' style={{ zIndex: 201 }}>
            <div className='signerPermissionControls'>
              <div className='signerPermissionSetting'>Lattice Accounts</div>
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
            <div className='signerPermissionDetails'>The number of lattice accounts to derive</div>
          </div>
          <div className='signerPermission localSetting' style={{ zIndex: 200 }}>
            <div className='signerPermissionControls'>
              <div className='signerPermissionSetting'>Lattice Relay</div>
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
                disabled={this.state.latticeEndpointMode !== 'custom'}
                aria-label='Custom Lattice relay'
                placeholder={'Custom Relay'}
                value={this.state.latticeEndpoint}
                onChange={(e) => this.inputLatticeEndpoint(e)}
              />
            </div>
          </div>

          <div className='signerPermission localSetting' style={{ zIndex: 199 }}>
            <div className='signerPermissionControls'>
              <div className='signerPermissionSetting'>Lock Hot Signers on</div>
              <Dropdown
                label='Lock hot signers on'
                syncValue={this.store('main.accountCloseLock')}
                onChange={(value) => link.send('tray:action', 'setAccountCloseLock', value)}
                options={[
                  { text: 'Close', value: true },
                  { text: 'Quit', value: false }
                ]}
              />
            </div>
            <div className='signerPermissionDetails'>When should Wren relock your hot signers?</div>
          </div>
          {companionCredentials.map((credential, index) => {
            const confirm = this.state.revokeCompanionConfirm === credential.fingerprint
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
                  <RevokeCompanion
                    type='button'
                    $confirm={confirm}
                    onClick={() => {
                      if (!confirm) {
                        this.setState({ revokeCompanionConfirm: credential.fingerprint })
                        return
                      }
                      link.rpc('revokeExtensionCredential', credential.fingerprint, (error) => {
                        if (!error) this.setState({ revokeCompanionConfirm: undefined })
                      })
                    }}
                  >
                    {confirm ? 'Confirm revoke' : 'Revoke'}
                  </RevokeCompanion>
                </div>
                <div className='signerPermissionDetails'>
                  Remove this pairing and require a new code confirmation on reconnect
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }
}

export default Restore.connect(Settings)
