import { useEffect } from 'react'

import type { MainStrings } from '../../../shared/desktop'
import { useOptionalI18n } from '../i18n/I18nProvider'

/** Gives the main process's dialogs and tray icon their words, in the window's language. */
export function useMainStrings(): void {
  const { t, locale } = useOptionalI18n()
  useEffect(() => {
    const strings: MainStrings = {
      appName: 'Agent Workspace',
      closeRunningTitle: t('main.close.runningTitle', { count: '{count}' }),
      closeServicesTitle: t('main.close.servicesTitle'),
      closeBody: t('main.close.body'),
      closeBackground: t('main.close.background'),
      closeQuit: t('main.close.quit'),
      closeCancel: t('main.close.cancel'),
      closeRemember: t('main.close.remember'),
      hiddenNotice: t('main.hiddenNotice'),
      trayShow: t('main.tray.show'),
      trayQuit: t('main.close.quit'),
      trayRunning: t('main.tray.running', { count: '{count}' }),
      draftTitle: t('main.draft.title'),
      draftMessage: t('main.draft.message'),
      draftDetail: t('main.draft.detail'),
      draftKeep: t('main.draft.keep'),
      draftClose: t('main.draft.close'),
      crashMessage: t('main.crash.message'),
      crashDetail: t('main.crash.detail', { folder: '{folder}' }),
      crashRestart: t('main.crash.restart'),
      crashClose: t('main.crash.close'),
    }
    window.agentWorkspace?.desktop?.setMainStrings?.(strings)
  }, [t, locale])
}
