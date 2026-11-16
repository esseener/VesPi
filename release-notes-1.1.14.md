# VesPi 1.1.14

- Keep room for the OMP terminal when opening Browser, Files or Review; stack the auxiliary pane beneath it in narrow windows.
- Keep model menus and settings dropdowns in viewport-level layers, with opaque backgrounds and bounded scrolling.
- Fit toolbar labels to the available pane width and wrap settings controls at the supported minimum window size.
- Enable xterm Unicode 11 widths, remove duplicate terminal padding, preserve columns for translated tips, and protect split ANSI frames and OSC payloads.
- Respect English terminal output; reduce isolated word substitutions in Chinese mode.
- Pass the saved provider/model into terminal startup and restart, so the toolbar and newly started OMP agree.
- Send Esc from the Interrupt button, matching OMP's cancellation key.
- Measure terminal rows and columns inside a padding-free host, keeping the bottom border visible at 800×600; preserve complete English labels instead of translating individual words within them.

Runtime: OMP 18.20.3. This is a local acceptance candidate; installed checks and remaining coverage are recorded in `docs/debug-2026-11-16.md`.
