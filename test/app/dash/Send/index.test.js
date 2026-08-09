import Restore from 'react-restore'

import { Send } from '../../../../app/dash/Send'
import link from '../../../../resources/link'
import { fireEvent, render, screen } from '../../../componentSetup'

jest.mock('../../../../resources/link', () => ({ send: jest.fn() }))

const sendDappId = '0xe8d705c28f65bc3fe10df8b22f9daa265b99d0e1893b2df49fd38120f0410bca'

const renderSend = ({ status = 'loading', connected = false } = {}) => {
  const store = Restore.create(
    {
      main: {
        dapps: { [sendDappId]: { status } },
        networks: {
          ethereum: {
            1: { on: true, connection: { endpoints: [{ connected }] } }
          }
        }
      }
    },
    {}
  )
  const ConnectedSend = Restore.connect(Send, store)
  return render(<ConnectedSend />)
}

it('shows a quiet loading state while the embedded view starts', () => {
  renderSend()

  expect(screen.getByLabelText('Loading Send')).toBeTruthy()
})

it('routes failed mainnet resolution to Networks without another window', () => {
  renderSend({ status: 'failed' })

  fireEvent.click(screen.getByRole('button', { name: 'View Networks' }))

  expect(link.send).toHaveBeenCalledWith('tray:action', 'navDash', { view: 'chains', data: {} })
  expect(link.send).not.toHaveBeenCalledWith('frame:close')
})
