import Restore from 'react-restore'

import AddToken from './AddToken'
import CustomTokens from './CustomTokens'
import FindTokens from './FindTokens'

const AddTokenForm = ({ data }) => <AddToken data={data} />

function Tokens({ data }) {
  if (data.notify === 'addToken') return <AddTokenForm data={data} />
  if (data.notify === 'findTokens') return <FindTokens />
  return <CustomTokens />
}

export default Restore.connect(Tokens)
