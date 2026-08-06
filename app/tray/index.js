import { createRoot } from 'react-dom/client'
import Restore from 'react-restore'

import App from './App'

import link from '../../resources/link'
import appStore from '../store'

document.addEventListener('dragover', (e) => e.preventDefault())
document.addEventListener('drop', (e) => e.preventDefault())

if (process.env.NODE_ENV !== 'development') {
  window.eval = global.eval = () => {
    throw new Error(`This app does not support window.eval()`)
  }
}

function AppComponent() {
  return <App />
}

link.on('flex', (event, value) => {
  if (event === 'shellJoined') {
    document.body.classList.toggle('workspace-joined', value === 'true')
  }
})

link.rpc('getState', (err, state) => {
  if (err) return console.error('Could not get initial state from main.')
  const store = appStore(state)
  link.send('tray:ready') // turn on api

  store.observer(() => {
    document.body.classList.remove('dark', 'light')
    document.body.classList.add('clip', store('main.colorway'))
    setTimeout(() => {
      document.body.classList.remove('clip')
    }, 100)
  })
  store.observer(() => {
    if (store('tray.open')) {
      document.body.classList.remove('suspend')
    } else {
      document.body.classList.add('suspend')
    }
  })
  store.observer(() => {
    const workspaceOpen = !!store('windows.dash.showing')
    const glideSide = store('main.glideSide') === 'left' ? 'left' : 'right'
    document.body.classList.toggle('workspace-open', workspaceOpen)
    document.body.classList.toggle('workspace-edge-left', glideSide === 'left')
    document.body.classList.toggle('workspace-edge-right', glideSide === 'right')
  })
  const root = createRoot(document.getElementById('tray'))
  const Tray = Restore.connect(AppComponent, store)
  root.render(<Tray />)
})
document.documentElement.addEventListener('mouseleave', () => link.send('tray:mouseout'))
document.addEventListener('contextmenu', (e) => link.send('*:contextmenu', e.clientX, e.clientY))
