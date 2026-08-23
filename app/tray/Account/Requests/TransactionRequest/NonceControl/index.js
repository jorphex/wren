import Icon from '../../../../../../resources/Components/Icon'
import link from '../../../../../../resources/link'
import { parseRpcQuantity } from '../../../../../../resources/domain/transaction/quantity'

export const nonceHasBeenChanged = (req) => {
  return req.data.nonce && req.payload.params?.[0]?.nonce !== req.data.nonce
}

export const displayTransactionNonce = (nonce) => {
  const parsed = parseRpcQuantity(nonce)
  return parsed === undefined ? 'Pending' : parsed.toString()
}

const NonceControl = ({ req, nonce = req.data.nonce, displayValue, hint, readOnly = false }) => {
  const mutable = !readOnly && !req.locked && req.status === undefined
  const displayed = displayValue ?? displayTransactionNonce(nonce)
  const requestReference = { account: req.account, handlerId: req.handlerId }

  return (
    <div className='transactionNonce'>
      <span className='transactionNonceDetails'>
        <span className='transactionNonceValue'>{displayed}</span>
        {hint ? <span className='transactionReviewNonceHint'>{hint}</span> : null}
      </span>
      {mutable && (
        <span className='transactionNonceActions'>
          <button
            type='button'
            aria-label='Decrease nonce'
            className='transactionNonceButton'
            onClick={() => link.send('tray:adjustNonce', requestReference, -1)}
          >
            <span className='transactionNonceGlyph' aria-hidden='true'>
              −
            </span>
          </button>
          <button
            type='button'
            aria-label='Increase nonce'
            className='transactionNonceButton'
            onClick={() => link.send('tray:adjustNonce', requestReference, 1)}
          >
            <span className='transactionNonceGlyph' aria-hidden='true'>
              +
            </span>
          </button>
          {nonceHasBeenChanged(req) && (
            <button
              type='button'
              aria-label='Reset nonce'
              className='transactionNonceButton transactionNonceReset'
              onClick={() => link.send('tray:resetNonce', requestReference)}
            >
              <Icon name='sync' size={14} />
            </button>
          )}
        </span>
      )}
    </div>
  )
}

export default NonceControl
