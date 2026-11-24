import Icon from '../Icon'
import svg from '../../svg'

export const accountTypeIcon = (type = '') => {
  if (type === 'address') return 'watch'
  if (type === 'seed') return 'seedling'
  if (type === 'ring') return 'key'
  if (type === 'trezor') return 'trezor'
  if (['ledger', 'lattice'].includes(type)) return 'hardware'
  return 'accounts'
}

export const getAccountTypeMarkSize = (type = '', baseSize = 17) => {
  if (type === 'ledger') return baseSize - 3
  return baseSize
}

const AccountTypeMark = ({ size = 17, type = '' }) => {
  const opticalSize = getAccountTypeMarkSize(type, size)

  if (type === 'ledger') return svg.ledger(opticalSize)
  if (type === 'lattice') return svg.lattice(opticalSize + 1)
  return <Icon name={accountTypeIcon(type)} size={opticalSize} />
}

export default AccountTypeMark
