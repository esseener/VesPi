# VesPi 1.1.13 — browser and terminal fixes

- Browser opens on its first selection, including before an address has been entered.
- Each workspace remembers its Browser address and whether the panel was open. A normal application restart restores that state.
- Browser links work in untrusted workspaces. The file preview keeps its separate workspace trust restrictions, and Browser remains limited to HTTP(S).
- Address bars follow links, redirects, and in-page navigation without reloading the newly reached page.
- “Ask model to open” fills the OMP terminal draft using the embedded panel tools. The user reviews and submits the draft.
- Missing/deleted session files no longer make a terminal restart exit with a session-not-found error.
- Bundled OMP updated to 18.20.3.

This is a locally installed acceptance candidate. Model-provider authorization failures and the live GitHub update-feed check remain unresolved acceptance items. No public release is authorized before the user confirms the installed application.
