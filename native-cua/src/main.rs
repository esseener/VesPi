//! VesPi's computer-use sidecar.
//!
//! Runs as a long-lived child of the VesPi main process and speaks one JSON
//! request/response per line over stdin/stdout. It exists because desktop
//! automation is not something Electron can do from the main process: there is no
//! API to inject a click at a screen coordinate, or to read another application's
//! accessibility tree.
//!
//! It is shipped inside the installer, so a user who downloads VesPi gets a
//! working desktop agent without installing anything else. That is also why it is
//! a plain executable rather than a Node addon: no native ABI to match against a
//! particular Electron build.
//!
//! Design rules, in the order they matter:
//!
//! - **Every method answers.** A stale window handle or a denied input is an error
//!   in the response, never a panic and never a dropped request: the shell is
//!   waiting on a matching `id`.
//! - **Text first.** `uitree` returns a readable list of named elements so a model
//!   that cannot see images is still able to drive an application. Screenshots are
//!   the fallback, not the only route.
//! - **Physical pixels everywhere.** Coordinates in and out are in the same space
//!   as the screenshot, so what the model measures is what gets clicked.

mod capture;
mod input;
mod protocol;
mod uia;
mod windows_info;

use std::io::{BufRead, BufWriter, Write};

use serde_json::{json, Value};

use protocol::{err, ok, Request};

fn dispatch(request: &Request) -> Result<Value, String> {
    match request.method.as_str() {
        "ping" => Ok(json!({ "pong": true })),

        "list_windows" => {
            let windows = windows_info::list_windows();
            let count = windows.len();
            let items: Vec<Value> = windows
                .iter()
                .enumerate()
                .map(|(id, info)| windows_info::window_json(id, info))
                .collect();
            Ok(json!({ "windows": items, "count": count }))
        }

        "screen_info" => Ok(windows_info::screen_json()),

        "focus_window" => windows_info::focus_window(&request.params),

        "capture" => capture::run(&request.params),

        "click" => input::click(&request.params),
        "type" => input::type_text(&request.params),
        "key" => input::press_keys(&request.params),
        "scroll" => input::scroll(&request.params),

        "uitree" => uia::tree(&request.params),
        "invoke_element" => uia::invoke(&request.params),

        other => Err(format!("unknown method: {other}")),
    }
}

fn main() {
    // Must happen before any rectangle or coordinate is read. Without it Windows
    // reports scaled values and every click lands somewhere else.
    unsafe {
        let _ = windows::Win32::UI::HiDpi::SetProcessDpiAwarenessContext(
            windows::Win32::UI::HiDpi::DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
        );
    }

    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut out = BufWriter::new(stdout.lock());

    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let request: Request = match serde_json::from_str(trimmed) {
            Ok(request) => request,
            Err(error) => {
                let payload = err(None, format!("bad request: {error}"));
                if writeln!(out, "{payload}").is_err() || out.flush().is_err() {
                    break;
                }
                continue;
            }
        };

        let response = match dispatch(&request) {
            Ok(result) => ok(request.id, result),
            Err(message) => err(request.id, message),
        };

        if writeln!(out, "{response}").is_err() || out.flush().is_err() {
            break;
        }
    }
}
