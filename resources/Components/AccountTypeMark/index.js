import Icon from '../Icon'
import svg from '../../svg'

export const accountTypeIcon = (type = '') => {
  if (type === 'address') return 'watch'
  if (type === 'seed') return 'seedling'
  if (type === 'ring') return 'key'
  if (['ledger', 'trezor', 'lattice'].includes(type)) return 'hardware'
  return 'accounts'
}

const AccountTypeMark = ({ size = 17, type = '' }) => {
  if (type === 'ledger') return svg.ledger(size)
  if (type === 'trezor') return svg.trezor(Math.max(10, size - 4))
  if (type === 'lattice') return svg.lattice(size + 1)
  return <Icon name={accountTypeIcon(type)} size={size} />
}

export default AccountTypeMark
