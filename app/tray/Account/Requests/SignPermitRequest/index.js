import { MAX_UINT256 } from '../../../../../resources/domain/transaction/quantity'
import {
  formatTokenBaseUnitAmount,
  MAX_TOKEN_DECIMALS,
  parseTokenBaseUnitAmount
} from '../../../../../resources/domain/token/amount'
import Icon from '../../../../../resources/Components/Icon'
import link from '../../../../../resources/link'
import { ClusterBox, Cluster, ClusterRow, ClusterValue } from '../../../../../resources/Components/Cluster'
import Countdown from '../../../../../resources/Components/Countdown'
import RequestHeader from '../../../../../resources/Components/RequestHeader'
import RequestItem from '../../../../../resources/Components/RequestItem'
import EditTokenSpend from '../../../../../resources/Components/EditTokenSpend'
import {
  SimpleTypedData as TypedSignatureOverview,
  getTypedDataDeviceWarning,
  TypedDataDeviceWarning,
  TypedDataWarnings
} from '../../../../../resources/Components/SimpleTypedData'
import { getSignatureRequestClass } from '../../../../../resources/domain/request'
import useCopiedMessage from '../../../../../resources/Hooks/useCopiedMessage'
import AddressIdentity from '../../../../../resources/Components/AddressIdentity'
import { resolveLocalAddressIdentity } from '../../../../../resources/domain/addressBook/identity'

const PermitOverview = ({ req, chainData, deviceWarning, originName, addressBook, accounts }) => {
  const { chainColor, chainName, icon } = chainData
  const {
    permit: { spender, value, deadline },
    tokenData,
    handlerId
  } = req
  const localIdentity = resolveLocalAddressIdentity(addressBook, accounts, spender.address)

  const [showCopiedMessage, copySpender] = useCopiedMessage(spender.address)

  const amount = parseTokenBaseUnitAmount(value)
  const hasTokenDecimals =
    Number.isInteger(tokenData.decimals) &&
    tokenData.decimals >= 0 &&
    tokenData.decimals <= MAX_TOKEN_DECIMALS
  const canEditAmount = amount !== undefined && hasTokenDecimals
  const amountDisplay =
    amount === undefined
      ? 'UNKNOWN AMOUNT'
      : amount === MAX_UINT256
        ? '~UNLIMITED'
        : hasTokenDecimals
          ? formatTokenBaseUnitAmount(value, tokenData.decimals)
          : 'UNKNOWN AMOUNT'

  const amountSuffix = tokenData.symbol || 'UNKNOWN TOKEN'

  return (
    <div className='approveRequest'>
      <div className='approveTransactionPayload'>
        <div className='_txBody'>
          <ClusterBox animationSlot={1}>
            <RequestItem
              key={`signErc20Permit:${handlerId}`}
              req={req}
              i={0}
              title={`${chainName} Token Permit`}
              color={chainColor ? `var(--${chainColor})` : ''}
              img={icon}
              headerMode={true}
            >
              <Cluster>
                <ClusterRow>
                  <ClusterValue
                    onClick={() => {
                      link.send('nav:update', 'panel', {
                        data: { step: 'viewRaw' }
                      })
                    }}
                  >
                    <div className='_txDescription'>
                      <RequestHeader chain={chainName} chainColor={chainColor}>
                        <div className='requestItemTitleSub'>
                          <div className='requestItemTitleSubIcon'>
                            <Icon name='apps' size={10} />
                          </div>
                          <div className='requestItemTitleSubText'>{originName}</div>
                        </div>
                        <div className='_txDescriptionSummaryMain'>{`Permit to Spend ${
                          tokenData.symbol || 'Unknown Token'
                        }`}</div>
                      </RequestHeader>
                    </div>
                  </ClusterValue>
                </ClusterRow>
              </Cluster>
            </RequestItem>
          </ClusterBox>
          <TypedDataWarnings context={req.context} />
          <TypedDataDeviceWarning warning={deviceWarning} />
          <ClusterBox title={'Token Permit'} animationSlot={2}>
            <Cluster>
              {tokenData && (
                <>
                  <ClusterRow>
                    <ClusterValue pointerEvents={true} onClick={() => copySpender()}>
                      <div className='clusterAddress'>
                        <AddressIdentity
                          address={spender.address}
                          copied={showCopiedMessage}
                          label={localIdentity?.label || spender.ens}
                          source={localIdentity?.source || (spender.ens ? 'ENS' : '')}
                        />
                      </div>
                    </ClusterValue>
                  </ClusterRow>
                  <ClusterRow>
                    <ClusterValue>
                      <div
                        className='clusterTag'
                        style={{ color: 'var(--moon)' }}
                      >{`is requesting permission to spend`}</div>
                    </ClusterValue>
                  </ClusterRow>
                  <ClusterRow>
                    <ClusterValue
                      onClick={
                        canEditAmount &&
                        (() => {
                          link.send('nav:update', 'panel', {
                            data: {
                              step: 'adjustPermit',
                              tokenData
                            }
                          })
                        })
                      }
                    >
                      <div className='clusterFocus'>
                        <div className='clusterFocusHighlight'>{`${amountDisplay} ${amountSuffix}`}</div>
                      </div>
                    </ClusterValue>
                  </ClusterRow>

                  <ClusterRow>
                    <ClusterValue>
                      <div className='clusterTag'>Permit Expires In</div>
                    </ClusterValue>
                  </ClusterRow>

                  <ClusterRow>
                    <ClusterValue>
                      <Countdown
                        end={deadline * 1000}
                        innerClass='clusterFocusHighlight'
                        titleClass='clusterFocus'
                      />
                    </ClusterValue>
                  </ClusterRow>
                </>
              )}
            </Cluster>
          </ClusterBox>
        </div>
      </div>
    </div>
  )
}

const EditPermit = ({ req }) => {
  const { permit, tokenData } = req

  const { verifyingContract: contract, spender, value: amount, deadline: deadlineInSeconds } = permit

  const updateRequest = (newAmt, callback = () => {}) => {
    link.rpc('updateRequest', req.account, req.handlerId, { amount: newAmt }, null, callback)
  }
  const deadline = deadlineInSeconds * 1000

  const requestedAmount = req.payload.params[1].message.value

  const data = {
    ...tokenData,
    contract,
    spender,
    amount
  }

  return (
    <EditTokenSpend
      {...{
        data,
        requestedAmount,
        updateRequest,
        deadline
      }}
    />
  )
}

const PermitRequest = ({ req, originName, signer, step, chainData, addressBook = {}, accounts = {} }) => {
  const requestClass = getSignatureRequestClass(req)
  const deviceWarning = getTypedDataDeviceWarning(signer)

  const renderStep = () => {
    switch (step) {
      case 'adjustPermit':
        return <EditPermit req={req} />
      case 'viewRaw':
        return (
          <TypedSignatureOverview
            chainName={chainData.requestChainName}
            deviceWarning={deviceWarning}
            originName={originName}
            req={req}
          />
        )
      default:
        return (
          <PermitOverview
            originName={originName}
            req={req}
            chainData={chainData}
            deviceWarning={deviceWarning}
            addressBook={addressBook}
            accounts={accounts}
          />
        )
    }
  }

  return (
    <div key={req.id || req.handlerId} className={requestClass}>
      {renderStep()}
    </div>
  )
}

export default PermitRequest
