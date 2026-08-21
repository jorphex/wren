import { useEffect, useRef, useState } from 'react'
import link from '../link'

const useCopiedMessageForCopy = (copy, duration) => {
  const [showMessage, setShowMessage] = useState(false)
  const timer = useRef()
  const operation = useRef(0)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      operation.current += 1
      clearTimeout(timer.current)
    }
  }, [])

  const copyToClipboard = async () => {
    const currentOperation = operation.current + 1
    operation.current = currentOperation
    let result
    try {
      result = await copy()
    } catch {
      return false
    }
    if (!mounted.current || currentOperation !== operation.current || result?.success !== true) return false
    setShowMessage(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setShowMessage(false), duration)
    return true
  }

  return [showMessage, copyToClipboard]
}

const useCopiedMessage = (value, duration = 1000) =>
  useCopiedMessageForCopy(() => link.invoke('tray:writeClipboard', { secret: false, value }), duration)

export const useSecretCopiedMessage = (value, duration = 1000) =>
  useCopiedMessageForCopy(() => link.invoke('tray:writeClipboard', { secret: true, value }), duration)

export default useCopiedMessage
