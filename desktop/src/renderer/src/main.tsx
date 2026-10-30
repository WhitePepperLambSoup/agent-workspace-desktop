import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './app/App'
import { WorkbenchBridgeClient } from './bridge/client'
import { installSpringTokens } from './design/motion'
import { I18nProvider } from './i18n/I18nProvider'
import { loadMessages } from './i18n/messages'
import { loadLocale } from './i18n/storage'
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

const render = (): void => {
  createRoot(root).render(
    <StrictMode>
      <I18nProvider>
        <App client={workbenchBridge} />
      </I18nProvider>
    </StrictMode>,
  )
}

// The chosen language's messages arrive before the first paint (Simplified Chinese is built in).
void loadMessages(loadLocale()).then(render, render)

void workbenchBridge.start().catch(() => workbenchBridge.store.markDisconnected())
