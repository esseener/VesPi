# VesPi workbench

Reference: VoltAgent's Warp DESIGN.md (local catalog), adapted to VesPi's existing semantic theme tokens.

- Terminal-first workbench; retain the dark neutral canvas and orange accent. Keep main content quiet, use borders and surface hierarchy rather than decorative gradients.
- Default dark canvas is near-black (#070809). Sidebar, terminal and auxiliary workbench panes share the window-level subtle mesh; pane containers must not cover it with a separate opaque canvas. Controls retain slightly raised dark surfaces and legible secondary labels.
- Keep permanent navigation minimal: Settings and About only, alongside projects and sessions. Mission Control, workflow monitoring, plugin management, Notes and Diagnostics are removed from the shell. Do not duplicate the terminal status/branch in a persistent footer; show connection errors or waiting approvals only.
- Inter for controls, existing monospace stack for terminal and metadata. Toolbar labels 12–13px, secondary text readable with text-muted; avoid faint text for actionable controls.
- 8px spacing rhythm, 4–6px corner radius, 32px minimum toolbar targets. Primary actions have labels; compact widths may hide labels but retain accessible names and tooltips.
- Each asynchronous action needs pending, success or error feedback. Disable unavailable controls. Keyboard focus uses a visible accent ring.
- Process status describes the active terminal, not an unrelated RPC process. Do not imply a model is thinking just because its process is running.
- Search must search actual terminal scrollback. Restart must stay in the workspace. Settings and model selection must make their effect clear.
- Check the actual Electron window at 1200×820 and its supported minimum 800×600; preserve readable controls and constrain popovers to the viewport.
