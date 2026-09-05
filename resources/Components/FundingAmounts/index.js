import { useState } from 'react'

import { tokenAmountPresentation } from '../../domain/token/display'

const FundingAmounts = ({ evidence, decimals, symbol, hideBalances = false }) => {
  const [showExact, setShowExact] = useState(false)
  const rows = ['available', 'required', 'missing'].map((key) => ({
    key,
    label: key[0].toUpperCase() + key.slice(1),
    ...tokenAmountPresentation(evidence[key], decimals, symbol, key === 'available' ? 'down' : 'up')
  }))
  return (
    <div className='fundingAmounts'>
      <dl className='transactionFundingFacts'>
        {rows.map(({ key, label, display, exact }) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{hideBalances ? '••••' : showExact ? exact : display}</dd>
          </div>
        ))}
      </dl>
      {!hideBalances && rows.some(({ display, exact }) => display !== exact) ? (
        <button
          type='button'
          className='fundingExactAmounts'
          aria-pressed={showExact}
          onClick={() => setShowExact((value) => !value)}
        >
          Exact amounts
        </button>
      ) : null}
    </div>
  )
}

export default FundingAmounts
