; Zephyr NSIS hooks.
;
; The stock Tauri installer only knows about the main executable. The mihomo
; core Zephyr spawns keeps $INSTDIR\mihomo.exe open, so an upgrade over a
; running install failed with "Error opening file for writing". Stop both the
; app and any core launched from this install before touching files. Matching
; on the install path leaves other Clash clients' cores alone.

!macro _ZEPHYR_STOP_RUNNING
  DetailPrint "Stopping Zephyr and its core..."
  nsExec::ExecToLog `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-Process zephyr,mihomo -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like '$INSTDIR\*' } | Stop-Process -Force -ErrorAction SilentlyContinue"`
  Pop $0
  ; Give the kernel a moment to release the file handles.
  Sleep 800
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro _ZEPHYR_STOP_RUNNING
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro _ZEPHYR_STOP_RUNNING
!macroend
