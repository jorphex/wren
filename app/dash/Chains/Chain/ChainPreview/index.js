import { ChainHeader } from '../Components'
import Connection from '../Connection'
import { Cluster } from '../../../../../resources/Components/Cluster'

const ChainPreview = (props) => {
  const { type, id, icon, name, isTestnet, on, primaryColor, compact, connection } = props
  const connected = connection?.endpoints?.some(
    (endpoint) => endpoint?.connected || endpoint?.status === 'connected'
  )
  const status = !on ? 'Off' : connected ? 'Connected' : 'Unavailable'
  return (
    <div className={compact ? 'network networkCompact' : 'network'}>
      <ChainHeader
        type={type}
        id={id}
        icon={icon}
        name={name}
        isTestnet={isTestnet}
        on={on}
        primaryColor={primaryColor}
        showExpand={true}
        showToggle={true}
        compact={compact}
        status={compact ? status : undefined}
      />
      {on && !compact && (
        <div className='chainModules'>
          <Cluster>
            <Connection {...props} />
          </Cluster>
        </div>
      )}
    </div>
  )
}

export default ChainPreview
