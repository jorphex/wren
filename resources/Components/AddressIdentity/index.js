import Icon from '../Icon'
import { getAddress } from '../../utils'

const AddressIdentity = ({
  address,
  complete = false,
  copied = false,
  label = '',
  revealOnHover = true,
  source = ''
}) => {
  const checksummed = getAddress(address)

  return (
    <>
      {label ? (
        <span className='clusterAddressRecipient clusterAddressRecipientLabeled'>
          <span className='clusterAddressLabel'>
            {label}
            {source ? <small>{source}</small> : null}
          </span>
          <span className='clusterAddressEvidence'>{checksummed}</span>
        </span>
      ) : complete ? (
        <span aria-label={checksummed} className='clusterAddressRecipient clusterAddressRecipientComplete'>
          {checksummed}
        </span>
      ) : (
        <span aria-label={checksummed} className='clusterAddressRecipient'>
          {checksummed.substring(0, 8)}
          <Icon name='ellipsis' size={15} />
          {checksummed.substring(checksummed.length - 6)}
        </span>
      )}
      <div
        className={`clusterAddressRecipientFull${copied ? ' clusterAddressRecipientFullCopied' : ''}${
          revealOnHover ? '' : ' clusterAddressRecipientFullNoHover'
        }`}
      >
        {copied ? <span>{'Address copied'}</span> : <span className='clusterFira'>{checksummed}</span>}
      </div>
    </>
  )
}

export default AddressIdentity
