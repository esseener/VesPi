//! Mouse and keyboard injection.
//!
//! Input goes through `SendInput`, so the events are indistinguishable from a
//! person's at the OS level — that is the point, and also the reason the shell
//! gates every call: a click here can do anything a click by the user can.
//!
//! Text is typed as Unicode scan codes rather than virtual keys, so a model can
//! enter Chinese, accents or emoji without the sidecar having to guess the user's
//! keyboard layout.

use std::mem::size_of;

use serde_json::{json, Value};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT,
    KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, MOUSEINPUT, MOUSEEVENTF_ABSOLUTE,
    MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP,
    MOUSEEVENTF_MOVE, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_VIRTUALDESK,
    MOUSEEVENTF_WHEEL, MOUSE_EVENT_FLAGS, VIRTUAL_KEY, VK_BACK, VK_DELETE, VK_DOWN, VK_END, VK_ESCAPE, VK_F1, VK_F2,
    VK_F3, VK_F4, VK_F5, VK_F6, VK_F7, VK_F8, VK_F9, VK_F10, VK_F11, VK_F12, VK_HOME, VK_INSERT,
    VK_LEFT, VK_LWIN, VK_MENU, VK_NEXT, VK_OEM_1, VK_OEM_2, VK_OEM_3, VK_OEM_4, VK_OEM_5,
    VK_OEM_6, VK_OEM_7, VK_OEM_COMMA, VK_OEM_MINUS, VK_OEM_PERIOD, VK_OEM_PLUS, VK_PRIOR,
    VK_RETURN, VK_RIGHT, VK_SHIFT, VK_SPACE, VK_TAB, VK_UP, VK_CONTROL,
};
use windows::Win32::UI::WindowsAndMessaging::SetCursorPos;

use crate::protocol;
use crate::windows_info;

/// Deliver a batch of events, or say so. A partial delivery is an error: it means
/// some of the intended clicks happened and some did not, which the model must
/// not be told was success.
fn send(inputs: &[INPUT]) -> Result<(), String> {
    if inputs.is_empty() {
        return Ok(());
    }
    let delivered = unsafe { SendInput(inputs, size_of::<INPUT>() as i32) };
    if delivered as usize != inputs.len() {
        return Err(format!(
            "Windows accepted {delivered} of {} input events — the rest were dropped",
            inputs.len()
        ));
    }
    Ok(())
}

fn mouse(flags: MOUSE_EVENT_FLAGS, dx: i32, dy: i32, data: i32) -> INPUT {
    INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx,
                dy,
                mouseData: data as u32,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

fn keyboard(key: VIRTUAL_KEY, scan: u16, flags: KEYBD_EVENT_FLAGS) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: key,
                wScan: scan,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

/// Screen pixels to the 0..65535 space `MOUSEEVENTF_ABSOLUTE` expects.
///
/// Normalised against the whole desktop and paired with `MOUSEEVENTF_VIRTUALDESK`
/// (see `click`): normalising against the primary monitor alone — as most
/// snippets do — puts every click on a second display in the wrong place, or on
/// the wrong screen entirely.
fn absolute(x: i32, y: i32) -> (i32, i32) {
    let desktop = windows_info::virtual_screen();
    let scale_x = 65535.0 / ((desktop.width - 1).max(1) as f64);
    let scale_y = 65535.0 / ((desktop.height - 1).max(1) as f64);
    (
        (((x - desktop.x) as f64) * scale_x).round().clamp(0.0, 65535.0) as i32,
        (((y - desktop.y) as f64) * scale_y).round().clamp(0.0, 65535.0) as i32,
    )
}

pub fn click(params: &Value) -> Result<Value, String> {
    let x = params
        .get("x")
        .and_then(Value::as_i64)
        .ok_or_else(|| "x is required".to_string())? as i32;
    let y = params
        .get("y")
        .and_then(Value::as_i64)
        .ok_or_else(|| "y is required".to_string())? as i32;
    let button = protocol::opt_string(params, "button").unwrap_or_else(|| "left".to_string());
    let count = protocol::i64_or(params, "count", 1).clamp(1, 3);

    let (down, up) = match button.as_str() {
        "right" => (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP),
        "middle" => (MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP),
        "left" => (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP),
        other => return Err(format!("unsupported button: {other}")),
    };

    let (normalised_x, normalised_y) = absolute(x, y);
    let mut events = vec![mouse(
        MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
        normalised_x,
        normalised_y,
        0,
    )];
    for _ in 0..count {
        events.push(mouse(down, 0, 0, 0));
        events.push(mouse(up, 0, 0, 0));
    }

    // Move the real cursor first: some applications read its position, and a user
    // watching needs to see where the click went.
    unsafe {
        let _ = SetCursorPos(x, y);
    }
    send(&events)?;

    Ok(json!({ "clicked": true, "x": x, "y": y, "button": button, "count": count }))
}

pub fn type_text(params: &Value) -> Result<Value, String> {
    let text = protocol::string(params, "text")?;
    let mut events = Vec::new();
    for unit in text.encode_utf16() {
        events.push(keyboard(VIRTUAL_KEY(0), unit, KEYEVENTF_UNICODE));
        events.push(keyboard(
            VIRTUAL_KEY(0),
            unit,
            KEYEVENTF_UNICODE | KEYEVENTF_KEYUP,
        ));
    }
    send(&events)?;
    Ok(json!({ "typed": text.chars().count(), "text": text }))
}

/// A key name to a virtual key: `"ctrl+s"`, `"enter"`, `"alt+tab"`.
pub fn press_keys(params: &Value) -> Result<Value, String> {
    let spec = protocol::string(params, "keys")?;
    let parts: Vec<&str> = spec
        .split('+')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect();
    if parts.is_empty() {
        return Err("keys is required".to_string());
    }

    let mut keys = Vec::new();
    for part in &parts {
        keys.push(key_for(part).ok_or_else(|| format!("unknown key: {part}"))?);
    }

    // Modifiers first, then release in reverse — otherwise a chord like ctrl+shift+s
    // arrives with the modifiers already up.
    let mut events: Vec<INPUT> = keys
        .iter()
        .map(|key| keyboard(*key, 0, KEYBD_EVENT_FLAGS::default()))
        .collect();
    for key in keys.iter().rev() {
        events.push(keyboard(*key, 0, KEYEVENTF_KEYUP));
    }
    send(&events)?;

    Ok(json!({ "pressed": spec }))
}

pub fn scroll(params: &Value) -> Result<Value, String> {
    let amount = protocol::i64_or(params, "amount", 0) as i32;
    if amount == 0 {
        return Err("amount is required (positive scrolls up, negative down)".to_string());
    }
    let notches = ((amount.abs() + 119) / 120).clamp(1, 20);
    let step = if amount > 0 { 120 } else { -120 };
    let events: Vec<INPUT> = (0..notches)
        .map(|_| mouse(MOUSEEVENTF_WHEEL, 0, 0, step))
        .collect();
    send(&events)?;
    Ok(json!({ "scrolled": amount, "notches": notches }))
}

fn key_for(name: &str) -> Option<VIRTUAL_KEY> {
    let lower = name.to_ascii_lowercase();
    let named = match lower.as_str() {
        "ctrl" | "control" => Some(VK_CONTROL),
        "alt" | "menu" => Some(VK_MENU),
        "shift" => Some(VK_SHIFT),
        "win" | "meta" | "super" => Some(VK_LWIN),
        "enter" | "return" => Some(VK_RETURN),
        "tab" => Some(VK_TAB),
        "space" => Some(VK_SPACE),
        "esc" | "escape" => Some(VK_ESCAPE),
        "backspace" | "back" => Some(VK_BACK),
        "delete" | "del" => Some(VK_DELETE),
        "insert" => Some(VK_INSERT),
        "home" => Some(VK_HOME),
        "end" => Some(VK_END),
        "pageup" | "pgup" => Some(VK_PRIOR),
        "pagedown" | "pgdn" => Some(VK_NEXT),
        "up" => Some(VK_UP),
        "down" => Some(VK_DOWN),
        "left" => Some(VK_LEFT),
        "right" => Some(VK_RIGHT),
        "f1" => Some(VK_F1),
        "f2" => Some(VK_F2),
        "f3" => Some(VK_F3),
        "f4" => Some(VK_F4),
        "f5" => Some(VK_F5),
        "f6" => Some(VK_F6),
        "f7" => Some(VK_F7),
        "f8" => Some(VK_F8),
        "f9" => Some(VK_F9),
        "f10" => Some(VK_F10),
        "f11" => Some(VK_F11),
        "f12" => Some(VK_F12),
        _ => None,
    };
    if named.is_some() {
        return named;
    }

    let mut chars = lower.chars();
    let first = chars.next()?;
    if chars.next().is_some() {
        return None;
    }
    if first.is_ascii_alphanumeric() {
        return Some(VIRTUAL_KEY(first.to_ascii_uppercase() as u16));
    }
    Some(match first {
        ';' => VK_OEM_1,
        '/' => VK_OEM_2,
        '`' => VK_OEM_3,
        '[' => VK_OEM_4,
        '\\' => VK_OEM_5,
        ']' => VK_OEM_6,
        '\'' => VK_OEM_7,
        ',' => VK_OEM_COMMA,
        '.' => VK_OEM_PERIOD,
        '-' => VK_OEM_MINUS,
        '=' => VK_OEM_PLUS,
        _ => return None,
    })
}
