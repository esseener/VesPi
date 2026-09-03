# VesPi memory

Long-lived product decisions. Agents MUST read this before shipping.

## Product

- Public repo: `esseener/VesPi` (git remote `vespi`). Do not publish updates to `FaqFirebase/pi-desktop`.
- Current shipped version: **1.0.1** (2026-09-02).
- Windows artifacts MUST include the version in the filename:
  - `VesPi-Setup-{version}-win-x64.exe`
  - `VesPi-{version}-win-x64.exe`

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
4. Only then: bump `package.json` if not already bumped, commit, push `master` to remote `vespi` (`https://github.com/esseener/VesPi.git`), tag `vX.Y.Z`, `gh release create` with both versioned exes.
5. Confirm an older client (`1.0.0` vs `1.0.1`, etc.) sees **有更新**.

`npm run preview` is for the agent during development. User acceptance is the **installed package**. Never push on the agent's say-so.

## 1.0.1 notes

- Select / confirm / input dialogs sit above the composer, same width as the input box.
- While the model is streaming, the send control is a stop square with a silver breathing light.
- About auto-checks on open and labels UI + kernel with **有更新**.
- Session delete confirms on the session row; Windows Recycle Bin + 打开回收站.
- Tool chrome tabs use the current page name (settings / about / notes / extensions).
- Kernel update shows download percent, then success or error.
- Mid-turn extra text: choose OMP `steer` vs `follow_up`. Neither aborts the current reply.
