import type { ObservedActivity } from '../../../main/store/state/types/accountActivity'
export const observedActivityLabels: Record<ObservedActivity['action'], string> = {
  received: 'Received assets',
  sent: 'Sent assets',
  transfer: 'Transfer',
  approve: 'Approve',
  deposit: 'Deposit',
  withdraw: 'Withdraw',
  redeem: 'Redeem',
  mint: 'Mint',
  call: 'Contract interaction',
  deploy: 'Contract deployment'
}
