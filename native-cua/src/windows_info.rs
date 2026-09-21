//! What is on the desktop: top-level windows, their rectangles, and the screen
//! itself.
//!
//! The model is told nothing it cannot verify, so every rectangle here is in
//! physical pixels — the same space as `capture`, and the same space the model
//! reads coordinates out of a screenshot in. The process declares per-monitor DPI
//! awareness at startup (see `main.rs`); without that the numbers would be scaled
//! and every click would land in the wrong place.

use serde_json::{json, Value};
use windows::core::PWSTR;
use windows::Win32::Foundation::{CloseHandle, BOOL, HWND, LPARAM, POINT, RECT, TRUE};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetClassNameW, GetCursorPos, GetForegroundWindow, GetSystemMetrics,
    GetWindowRect, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId, IsIconic,
    IsWindow, IsWindowVisible, SetForegroundWindow, ShowWindow, SM_CMONITORS, SM_CXSCREEN,
    SM_CXVIRTUALSCREEN, SM_CYSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
    SW_RESTORE,
};

pub struct WindowInfo {
    pub handle: HWND,
    pub title: String,
    pub class: String,
    pub rect: RECT,
    pub minimized: bool,
    pub foreground: bool,
    pub pid: u32,
    pub process: String,
}

struct Collector {
    foreground: HWND,
    items: Vec<WindowInfo>,
}

/// Visible top-level windows that have a title — the ones a person would name.
/// Invisible shells and empty-title helpers are dropped, because a list the model
/// cannot act on is worse than a shorter one it can.
pub fn list_windows() -> Vec<WindowInfo> {
    let mut collector = Collector {
        foreground: unsafe { GetForegroundWindow() },
        items: Vec::new(),
    };
    unsafe {
        let _ = EnumWindows(
            Some(collect),
            LPARAM(&mut collector as *mut Collector as isize),
        );
    }
    collector.items
}

unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let collector = &mut *(lparam.0 as *mut Collector);
    if !IsWindowVisible(hwnd).as_bool() {
        return TRUE;
    }
    let title = window_text(hwnd);
    if title.is_empty() {
        return TRUE;
    }
    let mut rect = RECT::default();
    if GetWindowRect(hwnd, &mut rect).is_err() {
        return TRUE;
    }
    let mut pid = 0u32;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    collector.items.push(WindowInfo {
        handle: hwnd,
        title,
        class: class_name(hwnd),
        rect,
        minimized: IsIconic(hwnd).as_bool(),
        foreground: hwnd == collector.foreground,
        pid,
        process: process_name(pid).unwrap_or_default(),
    });
    TRUE
}

fn window_text(hwnd: HWND) -> String {
    let length = unsafe { GetWindowTextLengthW(hwnd) };
    if length <= 0 {
        return String::new();
    }
    let mut buffer = vec![0u16; length as usize + 1];
    let copied = unsafe { GetWindowTextW(hwnd, &mut buffer) };
    String::from_utf16_lossy(&buffer[..copied.max(0) as usize])
}

fn class_name(hwnd: HWND) -> String {
    let mut buffer = [0u16; 256];
    let copied = unsafe { GetClassNameW(hwnd, &mut buffer) };
    String::from_utf16_lossy(&buffer[..copied.max(0) as usize])
}

/// The executable's file name, for the allow-list and for the model's benefit —
/// "notepad.exe" tells it more than a window title does.
fn process_name(pid: u32) -> Option<String> {
    if pid == 0 {
        return None;
    }
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buffer = [0u16; 1024];
        let mut size = buffer.len() as u32;
        let queried = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR(buffer.as_mut_ptr()),
            &mut size,
        );
        let _ = CloseHandle(handle);
        queried.ok()?;
        let full = String::from_utf16_lossy(&buffer[..size as usize]);
        let name = full
            .rsplit(['\\', '/'])
            .next()
            .unwrap_or(full.as_str())
            .to_string();
        Some(name)
    }
}

pub fn window_json(id: usize, info: &WindowInfo) -> Value {
    json!({
        "id": id,
        "handle": info.handle.0 as isize as i64,
        "title": info.title,
        "process": info.process,
        "pid": info.pid,
        "class": info.class,
        "x": info.rect.left,
        "y": info.rect.top,
        "width": info.rect.right - info.rect.left,
        "height": info.rect.bottom - info.rect.top,
        "minimized": info.minimized,
        "focused": info.foreground,
    })
}

/// The rectangle that covers every monitor, in the same coordinate space as
/// every window rectangle here.
///
/// This is not `SM_CXSCREEN`. On a machine with a second monitor to the right,
/// that reports only the primary display, and a window on the second screen would
/// be reported at an x beyond it — a capture aimed at `SM_CXSCREEN`'s box would
/// come back showing the wrong pixels, and a click normalised against it would
/// land on neither screen.
pub struct VirtualScreen {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

pub fn virtual_screen() -> VirtualScreen {
    unsafe {
        let width = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        let height = GetSystemMetrics(SM_CYVIRTUALSCREEN);
        if width > 0 && height > 0 {
            return VirtualScreen {
                x: GetSystemMetrics(SM_XVIRTUALSCREEN),
                y: GetSystemMetrics(SM_YVIRTUALSCREEN),
                width,
                height,
            };
        }
        // Falls back to the primary display, which is what the virtual metrics
        // report as zero before a second monitor has ever been attached.
        VirtualScreen {
            x: 0,
            y: 0,
            width: GetSystemMetrics(SM_CXSCREEN),
            height: GetSystemMetrics(SM_CYSCREEN),
        }
    }
}

/// Screen size, cursor position and the full desktop rectangle. The cursor is what
/// lets a model that reads a screenshot place a click without guessing where the
/// desktop starts.
pub fn screen_json() -> Value {
    let mut point = POINT::default();
    let cursor = unsafe { GetCursorPos(&mut point) };
    let screen = virtual_screen();
    json!({
        "width": unsafe { GetSystemMetrics(SM_CXSCREEN) },
        "height": unsafe { GetSystemMetrics(SM_CYSCREEN) },
        "desktop": {
            "x": screen.x,
            "y": screen.y,
            "width": screen.width,
            "height": screen.height,
            "monitors": monitor_count(),
        },
        "cursor": if cursor.is_ok() {
            json!({ "x": point.x, "y": point.y })
        } else {
            Value::Null
        },
    })
}

/// How many displays are attached. Reported so the model can tell a one-screen
/// desktop from a spread-out one when a coordinate looks out of range.
pub fn monitor_count() -> u32 {
    unsafe { GetSystemMetrics(SM_CMONITORS).max(1) as u32 }
}

/// A window resolved from a request: either by the handle the model was given
/// earlier, or by the index into the most recent `list_windows`.
pub struct FoundWindow {
    pub handle: HWND,
    pub title: String,
    pub rect: RECT,
    pub process: String,
    pub minimized: bool,
}

impl FoundWindow {
    pub fn width(&self) -> i32 {
        self.rect.right - self.rect.left
    }

    pub fn height(&self) -> i32 {
        self.rect.bottom - self.rect.top
    }
}

/// Resolve `handle` (preferred — it survives the list changing under us) or
/// `window` (the index from `list_windows`).
///
/// A stale index is reported as an error rather than silently clamped: acting on
/// the wrong window is far worse than being told to look again.
pub fn resolve(params: &Value) -> Result<FoundWindow, String> {
    if let Some(handle) = params.get("handle").and_then(Value::as_i64) {
        let hwnd = HWND(handle as isize as *mut core::ffi::c_void);
        if !unsafe { IsWindow(hwnd).as_bool() } {
            return Err(format!("no window with handle {handle}"));
        }
        return describe(hwnd);
    }

    let index = params.get("window").and_then(Value::as_i64).unwrap_or(-1);
    if index < 0 {
        return Err("window or handle is required".to_string());
    }
    let windows = list_windows();
    windows
        .into_iter()
        .nth(index as usize)
        .map(|info| FoundWindow {
            handle: info.handle,
            title: info.title,
            rect: info.rect,
            process: info.process,
            minimized: info.minimized,
        })
        .ok_or_else(|| format!("no window at index {index} — call list_windows again"))
}

fn describe(hwnd: HWND) -> Result<FoundWindow, String> {
    let mut rect = RECT::default();
    unsafe {
        GetWindowRect(hwnd, &mut rect)
            .map_err(|error| format!("could not read the window rectangle: {error}"))?;
    }
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    Ok(FoundWindow {
        handle: hwnd,
        title: window_text(hwnd),
        rect,
        process: process_name(pid).unwrap_or_default(),
        minimized: unsafe { IsIconic(hwnd).as_bool() },
    })
}

/// Bring a window forward, restoring it if it is minimized.
///
/// Windows only lets the foreground change under narrow conditions, so this
/// reports what actually happened instead of assuming it worked: the model needs
/// to know whether its next click will land on the window it means.
pub fn focus_window(params: &Value) -> Result<Value, String> {
    let window = resolve(params)?;
    unsafe {
        if window.minimized {
            let _ = ShowWindow(window.handle, SW_RESTORE);
        }
        let _ = SetForegroundWindow(window.handle);
    }
    let focused = unsafe { GetForegroundWindow() == window.handle };
    let after = describe(window.handle)?;
    Ok(json!({
        "focused": focused,
        "title": after.title,
        "x": after.rect.left,
        "y": after.rect.top,
        "width": after.width(),
        "height": after.height(),
        "minimized": after.minimized,
        "handle": after.handle.0 as isize as i64,
    }))
}

