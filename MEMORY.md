# VesPi memory

Long-lived product decisions. Agents MUST read this before shipping.

## Product

- Public repo: `esseener/VesPi` (git remote `vespi`). Do not publish updates to `FaqFirebase/pi-desktop`.
- Current shipped version: **1.0.11** (2026-09-03).
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
5. Copy the two shipped files into `desktop/release/`:
   - `VesPi-Setup-{version}-win-x64.exe`
   - `VesPi-{version}-win-x64.exe`
   Remove older versioned exes from that folder so it only holds the latest installer.
6. Confirm an older client (`1.0.0` vs `1.0.1`, etc.) sees **有更新**.

`npm run preview` is for the agent during development. User acceptance is the **installed package**. Never push on the agent's say-so.

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
