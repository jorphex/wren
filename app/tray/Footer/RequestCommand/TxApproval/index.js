import Icon from '../../../../../resources/Components/Icon'
import link from '../../../../../resources/link'

import { Cluster, ClusterValue, ClusterRow } from '../../../../../resources/Components/Cluster'

const TxApproval = ({ req, approval }) => {
  const title = approval?.data?.title || 'estimated to fail'
  const confirmLabel = approval?.data?.confirmLabel || 'Proceed'

  return (
    <div className='approveTransactionWarning'>
      <div className='approveTransactionWarningBody'>
        <Cluster>
          <ClusterRow>
            <ClusterValue>
              <div className='approveTransactionWarningTitle'>
                <div className='approveTransactionWarningIcon approveTransactionWarningIconLeft'>
                  <Icon name='alert' size={32} />
                </div>
                {title}
                <div className='approveTransactionWarningIcon approveTransactionWarningIconRight'>
                  <Icon name='alert' size={32} />
                </div>
              </div>
            </ClusterValue>
          </ClusterRow>
          <ClusterRow>
            <ClusterValue pointerEvents>
              <button
                type='button'
                className='_txActionButton _txActionButtonBad'
                onClick={() => {
                  link.rpc('declineRequest', req, () => {})
                }}
              >
                Reject
              </button>
            </ClusterValue>
            <ClusterValue pointerEvents>
              <button
                type='button'
                className='_txActionButton _txActionButtonGood'
                onClick={() => {
                  link.rpc('confirmRequestApproval', req, approval.type, {}, () => {})
                }}
              >
                {confirmLabel}
              </button>
            </ClusterValue>
          </ClusterRow>
          <ClusterRow>
            <ClusterValue>
              <div className='approveTransactionWarningMessage'>
                {approval && approval.data && approval.data.message}
              </div>
            </ClusterValue>
          </ClusterRow>
        </Cluster>
      </div>
    </div>
  )
}

export default TxApproval
