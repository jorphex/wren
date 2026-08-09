import { useEffect, useRef, useState } from 'react'
import link from '../link'

const useCopiedMessage = (value, duration = 1000) => {
  const [showMessage, setShowMessage] = useState(false)
  const timer = useRef()

  useEffect(() => () => clearTimeout(timer.current), [])

  const copyToClipboard = () => {
    link.send('tray:clipboardData', value)
    setShowMessage(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setShowMessage(false), duration)
  }

  return [showMessage, copyToClipboard]
}

export default useCopiedMessage
