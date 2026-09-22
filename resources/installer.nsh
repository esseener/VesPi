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

; ---------------------------------------------------------------------------
; Removing the old version before installing the new one.
;
; electron-builder's default is clever and fragile: instead of deleting, it
; RENAMES every file in the install directory into "$PLUGINSDIR\old-install" so
; that a failure can be rolled back, and if any single rename fails it restores
; everything and aborts the uninstall. The new installer then retries the whole
; thing up to five times (templates/nsis/include/installUtil.nsh).
;
; Two things make that go wrong on a real machine:
;
;  * "$PLUGINSDIR" is in the system temp directory, so on an install that lives
;    on another drive (E:\VesPi, say) every rename is a cross-volume MOVE. For
;    this app that is the 207 MB packaged app plus the 154 MB kernel copied to
;    C: — and copied back again when something later in the walk fails. On a
;    machine whose system drive is short of space, the rename fails instead, and
;    the result is a deadlock that looks like the installer doing nothing at all.
;  * Anything the app still holds open — VesPi.exe itself when the old process
;    has not finished exiting — fails its rename, which triggers that restore
;    and abort path, over files that were fine.
;
; The reported symptom is exactly that: the old uninstaller sits with no window
; and no CPU, the new installer waits on it, and the update never finishes.
;
; So take the plain path that every other installer takes: delete what can be
; deleted, leave what cannot, and let the install continue over the top. A file
; that survives is one the next install overwrites anyway, and there is nothing
; to roll back to a half-renamed state. This replaces the template's whole
; remove block, so the `RMDir` has to happen here.
;
; Defined in the include so it applies to both the uninstaller and the
; pre-install removal. See `!ifmacrodef customRemoveFiles` in
; node_modules/app-builder-lib/templates/nsis/uninstaller.nsh.
; ---------------------------------------------------------------------------
!macro customRemoveFiles
  DetailPrint "VesPi: removing $INSTDIR in place (no cross-volume staging)"
  SetOutPath $TEMP
  RMDir /r $INSTDIR
!macroend
