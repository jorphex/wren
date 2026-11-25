import { createRoot } from 'react-dom/client'
import Restore from 'react-restore'

import App from './App'

import link from '../../resources/link'
import observeScrollEdges from '../scrollEdges'
import appStore from '../store'
import RecoveryBoundary, { RecoveryView } from '../tray/RecoveryBoundary'

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

if (!document.body.classList.contains('light')) document.body.classList.add('dark')
const dash = document.getElementById('dash')
observeScrollEdges(document.body, [
  '.dash',
  '.dashMainScroll',
  '.sendLedger',
  '.sendSweepAssets',
  '.sendSweepReviewContent',
  '.addAccounts',
  '.addAccountItemDevices',
  '.addAccountItemOptionList',
  '.addAccountItemOptionSetupFrame',
  '.generatedWalletFrameBody',
  '.hardwareSignerPromptSurface.expandedSigner',
  '.earnDetailsContent',
  '.addressBookEditorScroll',
  '.networkEditorBody',
  '.localSettingsWrap',
  '.recentRecipientsDialog',
  '.notifyBoxSlide'
])

const root = createRoot(dash, { onCaughtError: () => {} })
const reloadDashboard = () => link.send('dash:reload')
let stopDashboard

window.addEventListener(
  'pagehide',
  () => {
    stopDashboard?.()
    clearTimeout(shellRevealTimer)
    cancelAnimationFrame(shellRevealFrame)
  },
  { once: true }
)

function startDashboard() {
  const recovery = {
    onRetry: startDashboard,
    onReload: reloadDashboard,
    view: 'Dashboard'
  }
  root.render(<RecoveryView {...recovery} pending />)
  let settled = false
  let cancelRpc
  const fail = () => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    cancelRpc?.()
    console.error('Dashboard state could not be loaded')
    root.render(<RecoveryView {...recovery} />)
  }
  const timer = setTimeout(fail, 10_000)
  const lifetime = new AbortController()
  stopDashboard = () => {
    settled = true
    clearTimeout(timer)
    cancelRpc?.()
    lifetime.abort()
  }
  cancelRpc = link.rpc('getState', (error, state) => {
    if (settled) return
    if (error || !state?.main || !state.windows) return fail()
    try {
      mountDashboard(state, lifetime.signal)
      settled = true
      clearTimeout(timer)
    } catch {
      lifetime.abort()
      fail()
    }
  })
}

function mountDashboard(state, signal) {
  const store = appStore(state, { signal })
  window.store = store
  let colorTimer
  const theme = store.observer(() => {
    document.body.classList.remove('dark', 'light')
    document.body.classList.add('clip', store('main.colorway'))
    clearTimeout(colorTimer)
    colorTimer = setTimeout(() => document.body.classList.remove('clip'), 100)
  })
  signal.addEventListener(
    'abort',
    () => {
      theme.remove()
      clearTimeout(colorTimer)
    },
    { once: true }
  )
  const workspaceEdge = store.observer(() => {
    const glideSide = store('main.glideSide') === 'left' ? 'left' : 'right'
    document.body.classList.toggle('workspace-edge-left', glideSide === 'left')
    document.body.classList.toggle('workspace-edge-right', glideSide === 'right')
  })
  signal.addEventListener('abort', () => workspaceEdge.remove(), { once: true })
  const Dash = Restore.connect(AppComponent, store)
  root.render(
    <RecoveryBoundary view='Dashboard' onReload={reloadDashboard}>
      <Dash />
    </RecoveryBoundary>
  )
}

startDashboard()

document.addEventListener('contextmenu', (e) => link.send('*:contextmenu', e.clientX, e.clientY))

// document.addEventListener('mouseout', e => { if (e.clientX < 0) link.send('tray:mouseout') })
// document.addEventListener('contextmenu', e => link.send('tray:contextmenu', e.clientX, e.clientY))
