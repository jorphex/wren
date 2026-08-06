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

let shellRevealTimer
let shellRevealFrame

const revealShellContent = () => {
  clearTimeout(shellRevealTimer)
  cancelAnimationFrame(shellRevealFrame)
  shellRevealFrame = requestAnimationFrame(() => {
    shellRevealFrame = requestAnimationFrame(() => {
      document.body.classList.remove('workspace-content-prepared', 'workspace-content-concealing')
    })
  })
}

const prepareShellContent = () => {
  clearTimeout(shellRevealTimer)
  cancelAnimationFrame(shellRevealFrame)
  document.body.classList.remove('workspace-content-concealing')
  document.body.classList.add('workspace-content-prepared')
  shellRevealTimer = setTimeout(() => {
    revealShellContent()
  }, 600)
}

const concealShellContent = () => {
  clearTimeout(shellRevealTimer)
  cancelAnimationFrame(shellRevealFrame)
  document.body.classList.remove('workspace-content-prepared')
  document.body.classList.add('workspace-content-concealing')
}

link.on('flex', (event, value) => {
  if (event === 'shellLayout') {
    document.body.classList.toggle('workspace-overlay', value === 'overlay')
  } else if (event === 'shellContent') {
    if (value === 'prepare') prepareShellContent()
    if (value === 'conceal') concealShellContent()
    if (value === 'reveal') revealShellContent()
  }
})

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) revealShellContent()
})

link.rpc('getState', (err, state) => {
  if (err) return console.error('Could not get initial state from main')
  const store = appStore(state)
  window.store = store
  store.observer(() => {
    document.body.classList.remove('dark', 'light')
    document.body.classList.add('clip', store('main.colorway'))
    setTimeout(() => {
      document.body.classList.remove('clip')
    }, 100)
  })
  store.observer(() => {
    const glideSide = store('main.glideSide') === 'left' ? 'left' : 'right'
    document.body.classList.toggle('workspace-edge-left', glideSide === 'left')
    document.body.classList.toggle('workspace-edge-right', glideSide === 'right')
  })
  const root = createRoot(document.getElementById('dash'))
  const Dash = Restore.connect(AppComponent, store)
  root.render(<Dash />)
})

document.addEventListener('contextmenu', (e) => link.send('*:contextmenu', e.clientX, e.clientY))

// document.addEventListener('mouseout', e => { if (e.clientX < 0) link.send('tray:mouseout') })
// document.addEventListener('contextmenu', e => link.send('tray:contextmenu', e.clientX, e.clientY))
