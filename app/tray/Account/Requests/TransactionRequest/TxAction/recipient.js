import { useEffect, useRef, useState } from 'react'

import Icon from '../../../../../../resources/Components/Icon'
import { getAddress } from '../../../../../../resources/utils'

const Recipient = ({ address, ens, copyAddress, textSize = 16 }) => {
  const [copied, setCopied] = useState(false)
  const copyTimeout = useRef()

  useEffect(() => {
    return () => clearTimeout(copyTimeout.current)
  }, [])

  const checkSummedAddress = getAddress(address)
  return (
    <>
      <div className='_txMainValue'>
        {ens ? (
          <span className='_txRecipient' style={{ fontSize: `${textSize}px` }}>
            {ens}
          </span>
        ) : (
          <span className='_txRecipient'>
            {checkSummedAddress.substring(0, 8)}
            <Icon name='ellipsis' size={15} />
            {checkSummedAddress.substring(address.length - 6)}
          </span>
        )}
        {/* {req.decodedData && req.decodedData.contractName ? ( 
          <span className={'_txDataValueMethod'}>{(() => {
            if (req.decodedData.contractName.length > 11) return `${req.decodedData.contractName.substr(0, 9)}..`
            return req.decodedData.contractName
          })()}</span>
        ) : null} */}
        <div
          className='_txRecipientFull'
          onClick={() => {
            copyAddress(checkSummedAddress)
            setCopied(true)
            clearTimeout(copyTimeout.current)
            copyTimeout.current = setTimeout(() => setCopied(false), 1000)
          }}
        >
          {copied ? (
            <span>{'Address Copied'}</span>
          ) : (
            <span className='_txRecipientFira'>{checkSummedAddress}</span>
          )}
        </div>
      </div>
    </>
  )
}

export default Recipient
