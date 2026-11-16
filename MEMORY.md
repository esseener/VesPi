# VesPi memory

Long-lived product decisions. Agents MUST read this before shipping.

## 2026-11-16 — 1.1.17 OMP adaptation installed candidate

- User explicitly authorized publishing 1.1.17 at 2026-11-16 17:15 +08:00 and tidying the development area. Public release authorization is granted; scheduled execution status belongs in `../work/publish-1.1.17/`, not a claim of publication before the job runs. Old builds/screenshots/one-off scripts moved to `../archive/2026-11-16/` with a reversible manifest. CI preserves an already uploaded installer/checksum pair so the locally verified bytes are not replaced by a rebuild.

- Native `defaultThinkingLevel` and explicit `--thinking` now apply correctly across session restoration; appearance changes preserve current effort. Settings use one save path, partial YAML updates, and serialized atomic GUI writes. Model catalog comes from `omp models --json`; model editing reads authoritative models.yml and preserves nested types.
- TUI reports its own PID/session/model/effort/busy/completion state; settings restart the actual session. Permissions, browser environment, dedicated TUI context, completion signals and auto-scroll are wired to the terminal. Removed ineffective council settings; legacy RPC backend still needs further review.
- Full check: 1384 tests, 1380 pass, 4 skip, 0 fail; types/lint/release/build passed. Final popup background and wording changes subsequently passed build/lint. OMP 18.20.3 confirmed current before packaging.
- release67 NSIS exit 0, ProductVersion 1.1.17.0. Installed/package app.asar SHA-256 both `d1e95454d541d61703f59e60a52310d6d9751715683128dfbe2de957b7a127c4`. Live TUI executable verified under installed `resources/runtime/omp/omp.exe`.
- Installed verification: sidebar row restores the requested session in the same TUI PID; high/medium effort changes preserve session/model/theme/symbols and restore high; 11 native chat models including full grok capabilities; models.yml authority; actual reply `VESPI_117_OMP_OK` and completion count increment. Status popup is opaque theme color #0d0f12; 1200×820 / 800×600 emulated layouts have no horizontal overflow, canvas #070809. Evidence: `../work/e2e-117/{navigation,model-turn}.json`, `../work/e2e-installed/omp-adaptation-settings.json`, `117-status.png`, `117-layout-800.png`.
- Installer in `release/VesPi-Setup-1.1.17-win-x64.exe`, 277361889 bytes; SHA-256 `4c9c39279692236f3c0827927f7b9a7f7504718cefadef5813ec2eda8a4d614c`. Prior installer/checksum archived in `../work/release-before-1.1.17/`.
- Full UI/RPC compatibility audit remains incomplete; complex Unicode paste/ZWJ and installed GitHub HTTP 403 remain unresolved. No new memory/advisor/prewalk service enabled. See `docs/omp-adaptation-2026-11-16.md` for capability assessment.
- No commit/push/tag/public release. Installed user acceptance pending per AGENTS.md. Update sources remain esseener/VesPi and can1357/oh-my-pi.
- Closed the isolated installed test instance; launched normal installed 1.1.17 with default GUI storage (PID 75180), verified its private OMP child (60984).

## 2026-11-16 — 1.1.16 slim installed candidate

- Removed Mission Control/task launching, workflow monitoring, plugin management, Notes, Diagnostics and the permanent bottom status bar. Dedicated components, state/actions, IPC, services, startup catalog preload/workflow scan and unsupported skill mutation stubs are deleted. Sidebar footer contains Settings/About. Native OMP tools/plugins and shared session/workspace infrastructure remain.
- Final check: 1378 tests, 1374 pass, 4 skip, 0 fail; typecheck/lint/release/build passed. OMP 18.20.3 confirmed newest before packaging. Build sizes: main 633.68 kB, preload 23.07 kB, renderer JS 4304.20 kB, CSS 95.10 kB.
- release66 installed with NSIS exit 0; ProductVersion 1.1.16.0. Installed/package app.asar both `dbbb9d62294c6aee48be4a974e76b51b045b6342f14c87c102ba813423e063ee`. Installer copied to `release/`, 273159201 bytes; SHA-256 `70dfab7dec82a7fd5a3cd4bc6532f72025190ca9ce10fca84755294ec49535d5`. Previous release files archived in `../work/release-before-1.1.16/`. Installer size increased despite smaller application JS/CSS; do not claim package-size reduction.
- Installed UI confirms removed entries/bridge APIs absent, Settings/About versions, README source read, browser fixture content, model filter, real a6-grok/grok-4.7 reply `VESPI_SLIM_116_OK`, selected terminal search match, session list and terminal restart. 1200×820 / 800×600 and actual Win32 800×600 have no horizontal overflow; background remains #070809. Evidence: `../work/e2e-installed/116-{navigation-19382,core-19382,final}.json` and screenshots.
- Interrupt clicked while idle only in this version; streaming-cancel evidence remains 1.1.14. Complete all-button coverage is not claimed. Historical complex Unicode paste loss, split ZWJ emoji, and installed GitHub feed HTTP 403 remain unresolved. Preserve unknown user data.
- No commit/push/tag/public release. Installed user acceptance is pending. UI/kernel update channels remain esseener/VesPi and can1357/oh-my-pi.

## 2026-11-16 — 1.1.15 near-black installed candidate

- release65 NSIS installed successfully (exit 0), installed ProductVersion 1.1.15.0; installer copied to `release/VesPi-Setup-1.1.15-win-x64.exe`. 270622183 bytes; SHA-256 `c8296a363f1c3fc1a7c8e3eec5bbbd82d6ad91eb4de761b3a40f3464782484f1`. Prior release-folder artifact archived in `../work/release-before-1.1.15/`.
- Installed/package app.asar match: `d430951003f6a39535b0926ffa7995f7457caeabc5beab1025443df64e05800e`. Dark canvas #070809, transparent auxiliary pane with continuous mesh, brighter secondary text. Installed colors and screenshots checked at 1200×820 and actual Win32 800×600 (no horizontal overflow).
- Full check: 1443 tests, 1439 pass, 4 skip, 0 fail; types/lint/release/build passed. Kernel 18.20.3 confirmed current before packaging.
- Main entry UI rerun on installed 1.1.15; Browser fixture loads, model menu opens, terminal search controls click. Notes UI create/save/read/edit/delete verified against disk. This is not complete all-button coverage; search match selection is not proven by entry smoke. Real a6 model/tool/background/fork/stream interruption evidence remains from 1.1.14.
- Installed GitHub feeds still HTTP 403; complex Unicode paste loss and ZWJ splitting remain. Detailed unverified button families recorded in `docs/debug-2026-11-16.md`.
- No commit/push/tag/public release. User installed acceptance still required; update feeds remain esseener/VesPi and can1357/oh-my-pi.

## 2026-11-16 — 1.1.14 installed layout candidate

- Final build is release64 (release62/63 superseded), installed successfully and copied to `release/VesPi-Setup-1.1.14-win-x64.exe`. 269728038 bytes; SHA-256 `47fc4e1dd641e6b34f922c8c253b43345b7ed6b2bad2959c41de55a2fa3f3519`. Installed app.asar equals package: `bb722bfcde2d70a66693962862f75f2f870d6e8123bf4e4330eabeafeb40ae50`. Prior release-folder installer archived under `../work/release-before-1.1.14/`.
- Terminal/pane responsive layout, portal model/settings menus, Unicode11 widths, width-safe translation/ANSI preservation, full-label translation boundaries, saved model at TUI start, Esc cancellation. FitAddon requires a padding-free measured host: padding on its border-box parent allocated too many rows and clipped the bottom frame at 800×600.
- Full check 1,443 tests: 1,439 pass, 4 skip, 0 fail; types/lint/build/release checks pass. OMP stays 18.20.3, checked current during this task.
- a6-grok/grok-4.7 real responses, write/read file, UI background launch/completion, IPC fork into a new session and subsequent response pass. Installed Esc cancels a pending request and permits a new response. Native settings frames fit 1200×820 / 800×600; actual Win32 800×600 resize gives 60 cols × 28 rows.
- Final installed streaming cancellation also passed in the actual 800×600 window: clicked during row 5, stopped at row 8 of 200, next reply `VESPI_STREAM_RECOVERED`. Evidence `installed-114-stream-final.json`.
- Limits: complex Unicode paste loses characters before submission; generated box output renders correctly, ZWJ emoji still splits visually. All-button audit is incomplete; do not equate layout screenshots with full functional coverage. Installed update feeds had HTTP 403. Unknown profile data retained. See `docs/debug-2026-11-16.md` for precise evidence.
- No commit/push/tag/public release; installed user acceptance is still required. UI/kernel feeds remain `esseener/VesPi` / `can1357/oh-my-pi`.

## 2026-11-16 — 1.1.13 installed debug candidate

- Final candidate: 1.1.13 / OMP 18.20.3. NSIS `release61/VesPi-Setup-1.1.13-win-x64.exe` installed with exit 0; installed app.asar SHA-256 equals the final packaged app.asar. No commit, push, tag or public release; user acceptance remains required.
- Installer: 264527608 bytes, SHA-256 `3ba4480337905d4d39d943aa9da86f3c98e4b01bc4aeaa6d701a0073773bf401`. Kernel SHA-256 `753c705d43c502f24751efd2b4b0c6c2fffc05db65c7b8b7771dca87146c2c19` matches the official lock; `kernel:check` confirms current.
- Fixed Browser first selection, blank workspace restoration, per-workspace URL/open persistence and startup adoption, navigation wrongly blocked by the preview trust gate, address synchronization after links/redirects/hash navigation, and the model action targeting a retired composer. Draft insertion now reaches OMP without submitting. Browser instructions name `panel_open` / `panel_text`.
- Fixed terminal restart after its remembered session file was deleted: missing resume paths start a fresh session.
- Final full `npm run check`: 1,438 tests, 1,434 passed, 4 skipped, 0 failed; typecheck, lint, release consistency and production build pass.
- Installed evidence: browser links/scripts/redirects/anchors, close/reopen, Settings round-trip, normal app restart, blank Browser workspace switch; named-pipe open/state/text/eval; hidden terminal draft startup + replacement; editor Save verified on disk; session history/rename/delete and branch-point listing; 73 commands; Ctrl+K palette; local plugin install/execute/remove; missing-session terminal restart. See `docs/debug-2026-11-16.md` and `../work/e2e-installed/final-summary.json`.
- External blockers remain model-provider 401/403 authorization and installed GitHub feed HTTP 403. Full model-written task / live cancellation and complete model fork remain unverified. Normal browser restart passed, immediate forced termination may recover a slightly older localStorage URL. OMP's native profile was not fully isolated by the GUI test launcher; unknown user history was preserved and the test plugin removed.
- UI and kernel feed repos unchanged: `esseener/VesPi`, `can1357/oh-my-pi`.

## 2026-11-15 — 1.1.11 local upgrade candidate

**Superseded by UI candidate 1.1.12:** full check passed with 1,428 tests (1,424 pass, 4 skip, zero failures). Real Electron interactions include model application visible in OMP, search, restart, interrupt input, clear, Settings and both window sizes. Production audit is clean. See `docs/upgrade-2026-11.md` for coverage limits and `release-notes-1.1.12.md` for changes.

- 1.1.12 installer: `release/VesPi-Setup-1.1.12-win-x64.exe`, 261092527 bytes; SHA-256 `ca7a124aa874db4c14261d63de9b030a131fcb3942bcd249b3f22b94feff5d95`. Previous installer archived under `../work/release-before-1.1.12/`.
- 1.1.12 NSIS installation completed with exit 0. Installed `VesPi.exe` reports ProductVersion 1.1.12.0; installed OMP reports 18.20.2 and SHA-256 matches the official lock. Installed app launched for user acceptance. No commit, push, tag or public release performed.

- App 1.1.11; Electron 45.3.2, React 19.3.1, Vite 8.3.8 / electron-vite 6, TypeScript 6.0.3, xterm 6, OMP 18.20.2. Versions checked against npm registry / official GitHub release.
- Terminal startup cancellation, native `--resume` restart, stale exit cleanup, resize retention, coalesced TUI session switches, background-session deletion, IPC sender validation, asynchronous clipboard migration, dead chat computations removed.
- `npm run check` passed: 1,424 tests, 1,420 pass, 4 skip, 0 fail; types, lint, kernel SHA-256 and production build pass. `kernel:check` confirms 18.20.2 current. Production npm audit: zero vulnerabilities; development tool transitive advisories remain.
- Real Electron smoke passed: OMP process and output, terminal resize/stop, text + PNG clipboard, rendered terminal screenshot. node-pty prebuild works despite local MSVC Spectre rebuild failure. Small fonts are emitted as files to keep font-src 'self'.
- Analysis and remaining architecture work: `docs/upgrade-2026-11.md`. TUI/RPC session ownership and status synchronization remain follow-up work; full paid model turn not tested.
- Installer built under `release-1.1.11-upgrade/`, copied with SHA256SUMS.txt to `release/`; prior release-folder installers archived under `../work/release-before-1.1.11/`.
- NSIS silent install completed with exit 0; `%LOCALAPPDATA%/Programs/VesPi/VesPi.exe` reports 1.1.11.0 and installed kernel reports 18.20.2. Installed app launched for user acceptance. No commit/push/tag/GitHub release; user acceptance remains the public-release gate.
- Installer SHA-256: `9592f02d3097a2760274cb279e115d86ddd66afc80c9b9cf602b720f8caa8490` (244.7 MiB).
- UI / kernel update feeds remain `esseener/VesPi` and `can1357/oh-my-pi`.

## Product

- Public repo: `esseener/VesPi` (git remote `vespi`). Do not publish updates to `FaqFirebase/pi-desktop`.
- Current shipped version: **1.0.13** (2026-09-03).
- Windows artifact: **installer only** — `VesPi-Setup-{version}-win-x64.exe`. The self-extracting portable exe was dropped in 1.0.10: it re-extracted ~400 MB (Electron + OMP + OpenSpace runtime) to %TEMP% on every launch, so double-click looked dead for minutes. A fast "portable" would have to be an extract-once ZIP instead.
- After every ship, copy the current installer into `desktop/release/` (the user's local keep folder). Replace older versioned exes there. Do not treat `release/` as git; it holds the local latest installer.

## Dual update reminders

UI and OMP are checked **together**, on launch and when About opens (`src/main/ipc/update-handlers.ts`).

| Channel | GitHub source | In-app action |
|---------|---------------|---------------|
| VesPi UI | `esseener/VesPi` Releases | About **有更新**, top banner, open release page |
| OMP kernel | `can1357/oh-my-pi` Releases | About **有更新**, top banner, in-app **更新内核** (replace `runtime/omp/omp.exe`) |

If either feed has a newer version, show **both** notices (banner + About + sidebar About dot). Never remind only one channel.

## Ship rule (installed local test → user OK → GitHub)

Do **not** push, tag, or publish a GitHub Release until the user has tested the change on **this machine's installed VesPi** (the NSIS install under `%LOCALAPPDATA%\Programs\VesPi\`, not only `npm run dev` / `preview`) and has **explicitly confirmed** it is good.

Loop:

1. Fix in `desktop/`.
2. Rebuild a versioned installer (`npm run package:win` / `package:win:nsis`) and **install it over the local VesPi** so the user runs the same artifact they would ship.
3. Wait for the user to test that installed app and say it is OK.
4. Only then: bump `package.json` if not already bumped, commit, push `master` to remote `vespi` (`https://github.com/esseener/VesPi.git`), tag `vX.Y.Z`, `gh release create` with the installer.
5. Copy the shipped file into `desktop/release/`:
   - `VesPi-Setup-{version}-win-x64.exe`
   (Installer only since 1.0.10 — the portable exe is discontinued; never ship it.)
   Remove older versioned exes from that folder so it only holds the latest installer.
6. Confirm an older client (`1.0.0` vs `1.0.1`, etc.) sees **有更新**.

`npm run preview` is for the agent during development. User acceptance is the **installed package**. Never push on the agent's say-so.

## 1.0.13 notes

- Root cause of "saved provider never shows in the model selector": OMP treats `models.yml` as the authoritative provider list whenever it exists — `models.json` is ignored entirely (verified on the 18.1.x kernel with isolated profiles). The real vespi profile had a stale models.yml with only a6api/s3ai, so nothing saved to models.json ever showed up. `MODELS_WRITE` now mirrors the config into `models.yml` (Pi keeps reading models.json). After saving once, the yml regenerates and all providers appear on the next kernel start.

## 1.0.12 notes

- Test-fetch models no longer collapses the provider row (that auto-collapse was intentional code but bad UX).
- After a successful provider save, if no session is mid-turn the kernel restarts automatically so the new provider/model appears in the selector right away; when something is running the manual restart hint stays.

## 1.0.11 notes

- Custom-provider fold collapsed on the first letter: the row id was derived from the key text (`custom-N` → the typed letter), so openIds lost it and the editor unmounted mid-typing. Rows now carry a stable uid; fold state survives typing, and drafts stay open.

## 1.0.10 notes

- Dropped the portable exe target (self-extracting 7z re-extracted the whole ~400 MB payload on every launch). Installer-only releases from now on.

## 1.0.9 notes

- Sidebar session row now appears the moment the first message is sent (`agent_start` refreshes the list; before, the only refresh ran while the new session file was still header-only and got filtered as empty).
- Sessions auto-title from the first prompt (Codex/ZCode-style, ≤40 chars, no model call). One shot per session; manual renames always win.

## 1.0.8 notes

- New-session startup no longer flickers: empty-chat tagline/chips/composer stay constant while OMP starts; `sendPrompt` waits (≤30s) for the ready event instead of silently dropping the send or double-starting.

## 1.0.7 notes

- Empty-chat project picker mirrors the real workspace (was stuck on its mount-time "No project").
- `package:win*` now runs `scripts/update-omp.mjs` first: pulls the newest OMP from `can1357/oh-my-pi` into `runtime/omp/` (tag marker `.version`; network failure keeps the existing kernel and still packages).

## 1.0.6 notes

- Top workspace tabs: the remove confirm now opens as a portal card under the tab. The old in-tab absolute card was clipped by the tab strip's overflow, so the × looked dead.

## 1.0.5 notes

- Removing a workspace confirms on that sidebar/tab row (same as session delete), not the bottom-of-window dialog.

## 1.0.4 notes

- Home/About **下载** downloads `VesPi-Setup-*-win-x64.exe` and opens the installer. It no longer only opens the GitHub repo page.

## 1.0.3 notes

- Native `<select>` popups were Windows white. Settings, permission rules, models, task launcher, and model setup now use a themed dark dropdown.

## 1.0.2 notes

- Home update banner buttons (下载 / 更新内核) were covered by the window-drag overlay. Banner is now above the drag layer and clickable on Home.
- Update check/download uses Electron `net` (Chromium + system/TUN proxy) instead of Node fetch. Failed GitHub checks show a readable proxy hint instead of failing silently.

## 1.0.1 notes

- Select / confirm / input dialogs sit above the composer, same width as the input box.
- While the model is streaming, the send control is a stop square with a silver breathing light.
- About auto-checks on open and labels UI + kernel with **有更新**.
- Session delete confirms on the session row; Windows Recycle Bin + 打开回收站.
- Tool chrome tabs use the current page name (settings / about / notes / extensions).
- Kernel update shows download percent, then success or error.
- Mid-turn extra text: choose OMP `steer` vs `follow_up`. Neither aborts the current reply.
# 2026-11 UI candidate 1.1.12

- UI candidate is version 1.1.12; OMP remains 18.20.2 and the kernel lock is current.
- The terminal workbench now has direct scrollback search, explicit interrupt/clear/restart actions, terminal-specific status, and model selection feedback.
- Model changes persist to the OMP profile and restart the local TUI with `--model`; known sessions use `--resume`, otherwise OMP uses `--continue`.
- Verified: typecheck, lint, full test suite, release consistency, kernel freshness, and real Electron interactions at 1200x820 and 800x600.
- User acceptance is still required before commit, push, tag, or GitHub release.
