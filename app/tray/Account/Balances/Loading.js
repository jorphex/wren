const BalanceLoading = () => (
  <div className='balanceLoading' role='status' aria-label='Loading balances'>
    {[0, 1, 2].map((row) => (
      <div className='balanceLoadingRow' key={row} aria-hidden='true'>
        <span className='balanceLoadingIcon' />
        <span className='balanceLoadingName'>
          <span />
          <span />
        </span>
        <span className='balanceLoadingAmount' />
      </div>
    ))}
  </div>
)

export default BalanceLoading
