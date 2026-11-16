# VesPi 1.1.16

- Remove the persistent footer that duplicated terminal connection and branch information.
- Remove Mission Control/task launching, workflow monitoring, plugin management, Notes and Diagnostics, including their dedicated services, startup work, state, IPC and UI.
- Remove unsupported skill create/delete/evolve API stubs; keep native OMP capabilities and read-only skill discovery.
- Keep only Settings and About in the sidebar footer, preserving update notifications and terminal-error / waiting-approval notices.
- Retain the continuous near-black workbench background.

Runtime: OMP 18.20.3. Local installed acceptance candidate.
