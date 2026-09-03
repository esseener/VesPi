# VesPi

**VesPi** is a Windows desktop client for **[Oh My Pi (OMP)](https://github.com/can1357/oh-my-pi)** and the **[Pi](https://pi.dev)** coding agent. Chat, tools, Diff, terminal, permissions, models, and kernel updates live in one window.

It is based on [Pi Desktop](https://github.com/FaqFirebase/pi-desktop) (Apache-2.0). The shipped Windows build runs a **private `omp.exe`** — you do not need a global `pi` or `omp` on PATH.

**Search:** VesPi · Pi · Pi Desktop · Oh My Pi · OMP · oh-my-pi · coding agent · desktop agent · Windows AI IDE

**Current release: [1.0.1](https://github.com/esseener/VesPi/releases/tag/v1.0.1)**

[Download Windows installer](https://github.com/esseener/VesPi/releases/latest) · [Oh My Pi kernel](https://github.com/can1357/oh-my-pi) · [Pi docs](https://pi.dev)

![VesPi home](docs/screenshots/Screenshot_20260824_181929.png)

## Why VesPi

- **Install and run.** Bundled OMP kernel (`runtime/omp/omp.exe`) with `--profile vespi --mode rpc-ui`.
- **Supervise the agent.** Streaming reply, thinking, tool cards, approvals, Diff, file tree, terminal.
- **Do not fork the kernel.** VesPi is the shell. OMP/Pi remain the agent. Sessions, models, and tools stay in the engine.
- **Two update channels.** UI from this repo. Kernel from `can1357/oh-my-pi`, with in-app **更新内核** and a visible download progress bar.

## Screenshots

| Home | Chat |
|---|---|
| ![Home](docs/screenshots/Screenshot_20260824_181929.png) | ![Chat](docs/screenshots/Screenshot_20260824_182005.png) |

| Sessions / files | Settings |
|---|---|
| ![Files](docs/screenshots/Screenshot_20260824_182039.png) | ![Settings](docs/screenshots/Screenshot_20260824_182117.png) |

## Highlights in 1.0.1

- **Session delete** confirms **on that session row** (name included), not a bottom-of-window dialog.
- **Windows Recycle Bin.** Deleted session files go to the system recycle bin. **打开回收站** is on the confirm row and on **关于**.
- **Tool tabs** show the page you opened (设置 / 关于 / 速记 / 拓展), not a generic “拓展坞”.
- **Kernel update progress.** Checking → download % and size → replace files → restart, then a success or error message.
- **Mid-turn extra text.** While OMP is writing, Enter does not send immediately. Choose:
  - **介入引导 (steer)** — OMP native queue. Does **not** abort the current reply or its tools. Injected after current tools finish, before the next model call (same idea as typing in the OMP TUI).
  - **排队等候 (follow_up)** — also does **not** abort. Sent when the agent is idle (no leftover tools or steering).

## What you get

- Streaming chat, thinking blocks, tool cards, markdown, SVG preview, clickable file links
- Composer `@` file mentions, prompt history with Up/Down, `#tags`
- Home dashboard: tokens, streaks, per-model usage
- Quick switcher `Ctrl+K` (commands, workspaces, sessions, files)
- Independent OMP/Pi process **per live session**; switching tabs does not kill the previous turn
- Mission Control, sidebar activity dots, optional desktop notifications
- Diff review with explicit Commit → Push → PR
- File tree, CodeMirror editor, image/HTML preview, ANSI terminal
- Permission modes + glob allow/deny rules (workspace trust gate)
- Package / skill browser, diagnostics, themes
- Dual engine: **OMP** (default, VesPi profile) and **Pi CLI** if you point Settings at one

## Engines: Oh My Pi (OMP) and Pi

| | OMP (default) | Pi |
|---|---|---|
| Binary | Bundled `omp.exe` | Optional `pi` |
| Profile | `--profile vespi` | standard Pi |
| Sessions | `~/.omp/profiles/vespi/agent/sessions` | `~/.pi/agent/sessions` |
| Protocol | JSONL RPC UI mode | same family |

Opening a session starts the engine that **wrote** that file, not whichever default is in Settings.

## Download (Windows x64)

From [Releases](https://github.com/esseener/VesPi/releases/latest):

- **Installer:** `VesPi-Setup-1.0.1-win-x64.exe` — recommended. Installs under `%LOCALAPPDATA%\Programs\VesPi\`.
- **Portable:** `VesPi-1.0.1-win-x64.exe`

Builds may be unsigned. SmartScreen: **More info → Run anyway**.

### Linux / macOS

Optional AppImage / unsigned `.dmg` may appear on Releases. Windows is the supported product path.

## Updates

On launch and when **关于** opens, VesPi checks **both**:

| Channel | Source | Action |
|---|---|---|
| VesPi UI | `esseener/VesPi` Releases | Banner + 有更新 → open the release |
| OMP kernel | `can1357/oh-my-pi` Releases | Banner + **更新内核** (progress, then success/error) |

## Develop

Needs Node.js. Private kernel is already in the repo as `runtime/omp/omp.exe` (packaged from the parent tree).

```bash
cd desktop
npm install
npm run dev
```

Windows installer:

```bash
npm run package:win:nsis
```

## Keyboard

| Shortcut | Action |
|---|---|
| Enter | Send (or open steer / follow-up chooser while streaming) |
| Shift+Enter | New line |
| Escape | Stop generation (`abort`) |
| Ctrl+K | Command palette |
| Ctrl+P | Cycle models |
| @ | Mention a workspace file |

## License

- VesPi changes: Apache-2.0
- Desktop shell originates from Pi Desktop GUI Contributors — keep NOTICE / copyright
- OMP remains upstream MIT; do not rebrand it as VesPi

Public repo: **[esseener/VesPi](https://github.com/esseener/VesPi)**. Do not publish product updates to `FaqFirebase/pi-desktop`.
