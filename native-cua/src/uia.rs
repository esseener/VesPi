//! The accessibility tree, rendered as text.
//!
//! This is what makes computer use work for *every* model rather than only the
//! ones that accept images. A text-only model cannot read a screenshot, but it can
//! read `button "Save" at 812,44` and act on it — and by index, not coordinates,
//! which survives the window moving.
//!
//! It also happens to be the safer route: a UIA invoke is delivered to the
//! specific element, so it works on a window that is not in front and never takes
//! the user's cursor.

use serde_json::{json, Value};
use windows::core::Interface;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationInvokePattern,
    TreeScope_Descendants, UIA_InvokePatternId,
};

use crate::input;
use crate::protocol;
use crate::windows_info;

/// Longest element name kept. Window titles and document names can be enormous;
/// the first line is what identifies them.
const MAX_NAME_CHARS: usize = 120;

/// Containers whose role alone tells the model nothing. They are dropped when
/// they have no name, which is most of them, and that keeps the tree readable.
const UNINFORMATIVE_ROLES: [&str; 6] = ["pane", "group", "custom", "window", "document", "control"];

pub fn tree(params: &Value) -> Result<Value, String> {
    let max = protocol::u32_or(params, "max", 300).clamp(1, 1000) as usize;
    let window = windows_info::resolve(params)?;
    let elements = collect(&window, max)?;

    Ok(json!({
        "window": {
            "title": window.title,
            "process": window.process,
            "handle": window.handle.0 as isize as i64,
        },
        "elements": elements,
        "count": elements.len(),
    }))
}

pub fn invoke(params: &Value) -> Result<Value, String> {
    let index = protocol::i64_or(params, "element", -1);
    if index < 0 {
        return Err("element is required (use the id from uitree)".to_string());
    }
    let window = windows_info::resolve(params)?;
    let automation = automation()?;
    let root = attach(&automation, &window)?;
    let condition = unsafe { automation.CreateTrueCondition() }
        .map_err(|error| format!("could not build the search condition: {error}"))?;
    let found = unsafe { root.FindAll(TreeScope_Descendants, &condition) }
        .map_err(|error| format!("could not read the accessibility tree: {error}"))?;
    let element = unsafe { found.GetElement(index as i32) }
        .map_err(|_| format!("no element with id {index} — call uitree again"))?;

    // Preferred: ask the control to do the thing. Nothing moves, nothing is focused,
    // and it works on a window the user cannot even see.
    if let Ok(pattern) = unsafe { element.GetCurrentPattern(UIA_InvokePatternId) } {
        if let Ok(invoke_pattern) = pattern.cast::<IUIAutomationInvokePattern>() {
            if unsafe { invoke_pattern.Invoke() }.is_ok() {
                let name = unsafe { element.CurrentName() }
                    .map(|name| name.to_string())
                    .unwrap_or_default();
                return Ok(json!({
                    "invoked": "accessibility",
                    "element": index,
                    "name": truncate(name.trim()),
                }));
            }
        }
    }

    // Fallback: a real click at the element's centre. The shell has already
    // approved this call, and the alternative is failing a task the user asked for.
    let rect = unsafe { element.CurrentBoundingRectangle() }
        .map_err(|_| format!("element {index} has no position to click"))?;
    let x = (rect.left + rect.right) / 2;
    let y = (rect.top + rect.bottom) / 2;
    input::click(&json!({ "x": x, "y": y }))?;

    Ok(json!({
        "invoked": "click",
        "element": index,
        "x": x,
        "y": y,
        "note": "the control had no accessible action, so it was clicked",
    }))
}

fn automation() -> Result<IUIAutomation, String> {
    unsafe {
        // Already-initialised apartments return an error code that is safe to
        // ignore; the sidecar may serve many requests in one process.
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
            .map_err(|error| format!("could not start UI Automation: {error}"))
    }
}

fn attach(
    automation: &IUIAutomation,
    window: &windows_info::FoundWindow,
) -> Result<IUIAutomationElement, String> {
    unsafe { automation.ElementFromHandle(window.handle) }
        .map_err(|error| format!("could not attach to \"{}\": {error}", window.title))
}

fn collect(window: &windows_info::FoundWindow, max: usize) -> Result<Vec<Value>, String> {
    let automation = automation()?;
    let root = attach(&automation, window)?;
    let condition = unsafe { automation.CreateTrueCondition() }
        .map_err(|error| format!("could not build the search condition: {error}"))?;
    let found = unsafe { root.FindAll(TreeScope_Descendants, &condition) }
        .map_err(|error| format!("could not read the accessibility tree: {error}"))?;
    let total = unsafe { found.Length() }.unwrap_or(0);

    let mut elements = Vec::new();
    for index in 0..total {
        if elements.len() >= max {
            break;
        }
        let Ok(element) = (unsafe { found.GetElement(index) }) else {
            continue;
        };
        if let Some(entry) = describe(&element) {
            let mut entry = entry;
            entry["id"] = json!(elements.len());
            elements.push(entry);
        }
    }
    Ok(elements)
}

fn describe(element: &IUIAutomationElement) -> Option<Value> {
    let control_type = unsafe { element.CurrentControlType() }
        .map(|value| value.0)
        .unwrap_or(0);
    let role = role_name(control_type);

    // Position first: an element with no rectangle cannot be acted on, and asking
    // for its name is comparatively expensive.
    let rect = unsafe { element.CurrentBoundingRectangle() }.ok()?;
    let width = rect.right - rect.left;
    let height = rect.bottom - rect.top;
    if width <= 0 || height <= 0 {
        return None;
    }

    let name = unsafe { element.CurrentName() }
        .map(|value| value.to_string())
        .unwrap_or_default();
    let name = name.trim();
    if name.is_empty() && UNINFORMATIVE_ROLES.contains(&role) {
        return None;
    }

    Some(json!({
        "role": role,
        "name": truncate(name),
        "x": rect.left,
        "y": rect.top,
        "width": width,
        "height": height,
        "enabled": unsafe { element.CurrentIsEnabled() }.map(|v| v.as_bool()).unwrap_or(true),
        "focused": unsafe { element.CurrentHasKeyboardFocus() }.map(|v| v.as_bool()).unwrap_or(false),
    }))
}

fn truncate(value: &str) -> String {
    if value.chars().count() <= MAX_NAME_CHARS {
        return value.to_string();
    }
    let kept: String = value.chars().take(MAX_NAME_CHARS).collect();
    format!("{kept}…")
}

/// UIA control type ids. Only the common ones are named; anything else is reported
/// as `control`, which is still enough for the model to know it found *something*.
fn role_name(control_type: i32) -> &'static str {
    match control_type {
        50000 => "button",
        50001 => "calendar",
        50002 => "checkbox",
        50003 => "combobox",
        50004 => "edit",
        50005 => "hyperlink",
        50006 => "image",
        50007 => "listitem",
        50008 => "list",
        50009 => "menu",
        50010 => "menubar",
        50011 => "menuitem",
        50012 => "progressbar",
        50013 => "radio",
        50014 => "scrollbar",
        50015 => "slider",
        50016 => "spinner",
        50017 => "statusbar",
        50018 => "tab",
        50019 => "tabitem",
        50020 => "text",
        50021 => "toolbar",
        50022 => "tooltip",
        50023 => "tree",
        50024 => "treeitem",
        50025 => "custom",
        50026 => "group",
        50027 => "thumb",
        50028 => "datagrid",
        50029 => "dataitem",
        50030 => "document",
        50031 => "splitbutton",
        50032 => "window",
        50033 => "pane",
        50034 => "header",
        50035 => "headeritem",
        50036 => "table",
        50037 => "titlebar",
        50038 => "separator",
        _ => "control",
    }
}
