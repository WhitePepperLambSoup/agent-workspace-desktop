import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './app/App'
import { endBootScreen } from './app/boot-screen'
import { ErrorBoundary, installUiErrorLogging, WindowCrash } from './app/ErrorBoundary'
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
installUiErrorLogging()
installSpringTokens()
const workbenchBridge = new WorkbenchBridgeClient(window.agentWorkspace)

const render = (): void => {
  createRoot(root).render(
    <StrictMode>
      <I18nProvider>
        <ErrorBoundary where="window" fallback={(error) => <WindowCrash error={error} />}>
          <App client={workbenchBridge} />
        </ErrorBoundary>
      </I18nProvider>
    </StrictMode>,
  )
}

// The chosen language's messages arrive before the first paint (Simplified Chinese is built in).
const rendered = loadMessages(loadLocale()).then(render, render)

const started = workbenchBridge.start().catch(() => workbenchBridge.store.markDisconnected())

void endBootScreen(workbenchBridge.store, started, rendered)
