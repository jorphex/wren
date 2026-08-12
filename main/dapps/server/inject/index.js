import { installFrameProvider } from '../../../../resources/provider/frame'

installFrameProvider(window, require('eth-provider')('frame'))

const currentScript = document.currentScript || document.scripts[document.scripts.length - 1]
currentScript.parentNode.removeChild(currentScript)
