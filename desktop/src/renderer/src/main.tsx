import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './app/App'
import { WorkbenchBridgeClient } from './bridge/client'
import { installSpringTokens } from './design/motion'
import { I18nProvider } from './i18n/I18nProvider'
import './design/tokens.css'
import './design/base.css'
import './design/glass.css'
import './workbench/workbench.css'
import './workbench/workbench-surfaces.css'
import './workbench/reference.css'
import './composer/composer-continuity.css'
import './design/motion.css'
import './design/desktop-transparency.css'

const root = document.getElementById('root')
if (!root) throw new Error('renderer_root_missing')
installSpringTokens()
const workbenchBridge = new WorkbenchBridgeClient(window.agentWorkspace)

createRoot(root).render(
  <StrictMode>
    <I18nProvider>
      <App client={workbenchBridge} />
    </I18nProvider>
  </StrictMode>,
)

void workbenchBridge.start().catch(() => workbenchBridge.store.markDisconnected())
