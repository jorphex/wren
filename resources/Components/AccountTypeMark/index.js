import Icon from '../Icon'
import svg from '../../svg'

export const accountTypeIcon = (type = '') => {
  if (type === 'address') return 'watch'
  if (type === 'seed') return 'seedling'
  if (type === 'ring') return 'key'
  if (['ledger', 'trezor', 'lattice'].includes(type)) return 'hardware'
  return 'accounts'
}

export const getAccountTypeMarkSize = (type = '', baseSize = 17) => {
  if (type === 'ledger') return baseSize - 3
  if (type === 'trezor') return baseSize + 4
  return baseSize
}

const AccountTypeMark = ({ size = 17, type = '' }) => {
  const opticalSize = getAccountTypeMarkSize(type, size)

  if (type === 'ledger') return svg.ledger(opticalSize)
  if (type === 'trezor') return svg.trezor(Math.max(10, opticalSize - 4))
  if (type === 'lattice') return svg.lattice(opticalSize + 1)
  return <Icon name={accountTypeIcon(type)} size={opticalSize} />
}

export default AccountTypeMark
