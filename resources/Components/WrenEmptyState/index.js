const WrenEmptyState = ({ image, title, copy, expanded = false, transparentImage = false }) => (
  <div
    className={`wrenEmptyState${expanded ? ' wrenEmptyStateExpanded' : ''}${
      transparentImage ? ' wrenEmptyStateTransparent' : ''
    }`}
  >
    <img
      className={`wrenEmptyStateImage${transparentImage ? ' wrenEmptyStateImageTransparent' : ''}`}
      src={image}
      alt=''
      aria-hidden='true'
    />
    <div className='wrenEmptyStateText'>
      <div className='wrenEmptyStateTitle'>{title}</div>
      {copy ? <div className='wrenEmptyStateCopy'>{copy}</div> : null}
    </div>
  </div>
)

export default WrenEmptyState
