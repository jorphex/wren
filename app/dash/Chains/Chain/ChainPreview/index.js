import { ChainHeader } from '../Components'
import Connection from '../Connection'
import Gas from '../../../../../resources/Components/Monitor'
import { Cluster } from '../../../../../resources/Components/Cluster'

const ChainPreview = (props) => {
  const { type, id, icon, name, isTestnet, on, primaryColor } = props
  return (
    <div className='network'>
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
      />
      {on && (
        <div className='chainModules'>
          <Cluster>
            <Connection {...props} />
            <div className='networkGasRows'>
              <Gas chainId={id} />
            </div>
          </Cluster>
        </div>
      )}
    </div>
  )
}

export default ChainPreview
