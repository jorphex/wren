import TxApproval from '../../Footer/RequestCommand/TxApproval'

const ReviewAcknowledgements = ({ req, readOnly = false }) =>
  req.approvals?.length ? (
    <div className='signingReviewAcknowledgements'>
      {req.approvals.map((approval) => (
        <TxApproval
          key={`${req.account}:${req.handlerId}:${approval.type}:${approval.data?.consentFingerprint || JSON.stringify(approval.data)}:${approval.approved}`}
          req={req}
          approval={approval}
          inline
          readOnly={readOnly || req.status !== undefined || req.locked}
        />
      ))}
    </div>
  ) : null

export default ReviewAcknowledgements
