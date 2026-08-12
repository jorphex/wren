import Icon from '../Icon'

const DAY_MS = 24 * 60 * 60 * 1000

export const addressSafetyTarget = (assessment, address) => {
  if (!assessment || typeof address !== 'string') return
  const normalized = address.toLowerCase()
  return assessment.targets?.find((target) => target.address === normalized)
}

const ageLabel = (assessment, target) => {
  if (!Number.isFinite(assessment?.assessedAt) || !Number.isFinite(target?.lastSubmittedAt)) return
  const days = Math.max(0, Math.floor((assessment.assessedAt - target.lastSubmittedAt) / DAY_MS))
  if (days === 0) return 'today'
  return `${days} day${days === 1 ? '' : 's'} ago`
}

const AddressSafetyStatus = ({ address, assessment }) => {
  const target = addressSafetyTarget(assessment, address)
  if (!target || target.state === 'new') return null

  if (target.state === 'lookalike') {
    return (
      <div className='addressSafetyStatus addressSafetyStatusLookalike' role='alert'>
        <Icon name='alert' size={16} />
        <span>
          <strong>Possible address poisoning.</strong> Verify the full address. Its first and last four
          characters match a destination you used before.
        </span>
      </div>
    )
  }

  const label = ageLabel(assessment, target)
  if (!label) return null
  const days = Math.max(0, Math.floor((assessment.assessedAt - target.lastSubmittedAt) / DAY_MS))
  return (
    <div
      className={`addressSafetyStatus addressSafetyStatusPrevious${days > 30 ? ' addressSafetyStatusStale' : ''}`}
    >
      Previously submitted to this address · {label}
    </div>
  )
}

export default AddressSafetyStatus
