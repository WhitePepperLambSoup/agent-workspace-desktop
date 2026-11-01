!macro customUnInstall
  ; An update runs the old uninstaller too; the new version sets its login item again when it starts.
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "AgentWorkspace"
  ${endIf}
!macroend
