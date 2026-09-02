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

## Ship rule (local test → GitHub)

Every tested local change that users should get MUST become a new version and a GitHub Release. Other models / agents follow this same loop:

1. Change and test locally (`npm run preview` / versioned portable).
2. Bump `package.json` (and README / docs version strings).
3. Commit. Push `master` to remote `vespi` (`https://github.com/esseener/VesPi.git`).
4. `npm run package:win`.
5. Tag `vX.Y.Z` and `gh release create` with both versioned exes.
6. Confirm an older client (`1.0.0` vs `1.0.1`, etc.) sees **有更新**.

Do not leave a finished UI/kernel change sitting only on this machine.

## 1.0.1 notes

- Select / confirm / input dialogs sit above the composer, same width as the input box.
- While the model is streaming, the send control is a stop square with a silver breathing light.
- About auto-checks on open and labels UI + kernel with **有更新**.
