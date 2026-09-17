; VesPi installer additions (wired through electron-builder's `nsis.include`).
;
; Windows resolves a pinned Start tile, a taskbar button and a toast identity
; through the app's AppUserModelID. VesPi sets `com.vespi.desktop` at runtime
; (index.ts) and the shortcuts electron-builder generates carry the same id, but
; nothing registers the id itself. An AUMID with no registration has no display
; name and no icon, so pinning the app produced a bare entry that looked nothing
; like an application. Registering it here — name plus the shipped icon — is what
; makes Windows treat it as a real app; the uninstaller takes it away again.
;
; The icon path is the shipped copy under the install directory's `resources`
; (extraResources maps `resources/` → `$INSTDIR\resources\resources\`), which is
; also where the app itself looks for it (getAppIconPath).

!macro customInstall
  WriteRegStr SHCTX "Software\Classes\AppUserModelId\com.vespi.desktop" "DisplayName" "VesPi"
  WriteRegStr SHCTX "Software\Classes\AppUserModelId\com.vespi.desktop" "IconUri" "$INSTDIR\resources\resources\icons\icon.ico"
!macroend

!macro customUnInstall
  DeleteRegKey SHCTX "Software\Classes\AppUserModelId\com.vespi.desktop"
!macroend
