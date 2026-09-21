//! Screenshots, in the same coordinate space as the rectangles in `windows_info`.
//!
//! Captures the composited desktop through GDI rather than any window-specific
//! API, because what the model must reason about is what the user is actually
//! looking at. A window covered by another window is not something a click at
//! those coordinates would reach either.
//!
//! Three deliberate properties:
//!
//! - The long edge is scaled down: a 4K PNG is megabytes of base64 for no extra
//!   understanding.
//! - The response carries `origin` and `scale`, so a model that measures a pixel
//!   in the image can convert it back to a screen coordinate. Without those two
//!   numbers every click from a window capture would be off by the window's
//!   position.
//! - The pixel buffer is capped before encoding, so a runaway capture cannot
//!   allocate the machine to death.

use std::mem::size_of;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde_json::{json, Value};
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
    ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, DIB_RGB_COLORS, SRCCOPY,
};

use crate::protocol;
use crate::windows_info;

/// Long edge the returned image is scaled to. Enough to read a toolbar, small
/// enough that several screenshots still fit in a context window.
pub const DEFAULT_MAX_EDGE: u32 = 1568;

/// Refuse to build a bitmap larger than this many pixels (~36 MP).
const MAX_PIXELS: u64 = 36_000_000;

/// `BI_RGB`: uncompressed, which is what `GetDIBits` gives us.
const BI_RGB_UNCOMPRESSED: u32 = 0;

struct Screenshot {
    width: u32,
    height: u32,
    rgba: Vec<u8>,
}

pub fn run(params: &Value) -> Result<Value, String> {
    let max_edge = protocol::u32_or(params, "max", DEFAULT_MAX_EDGE).clamp(256, 4096);

    let (origin_x, origin_y, width, height, source) = match windows_info::resolve(params) {
        Ok(window) => (
            window.rect.left,
            window.rect.top,
            window.width(),
            window.height(),
            json!({
                "kind": "window",
                "title": window.title,
                "process": window.process,
                "handle": window.handle.0 as isize as i64,
                "minimized": window.minimized,
            }),
        ),
        Err(_) if params.get("window").is_none() && params.get("handle").is_none() => {
            // The whole desktop, not the primary monitor: a window on a second
            // screen has to be reachable in the same image, or the model is
            // reasoning about a crop it cannot place.
            let desktop = windows_info::virtual_screen();
            (
                desktop.x,
                desktop.y,
                desktop.width,
                desktop.height,
                json!({
                    "kind": "desktop",
                    "monitors": windows_info::monitor_count(),
                }),
            )
        }
        Err(message) => return Err(message),
    };

    let shot = grab(origin_x, origin_y, width, height)?;
    let long_edge = shot.width.max(shot.height);
    let (pixels, out_width, out_height) = downscale(shot, max_edge);
    let scaled_long_edge = out_width.max(out_height).max(1);
    let png = encode_png(&pixels, out_width, out_height)?;

    Ok(json!({
        "pngBase64": BASE64.encode(&png),
        "bytes": png.len(),
        "width": out_width,
        "height": out_height,
        // screen = origin + imagePixel × scale
        "origin": { "x": origin_x, "y": origin_y },
        "scale": (long_edge as f64) / (scaled_long_edge as f64),
        "source": source,
    }))
}

fn grab(x: i32, y: i32, width: i32, height: i32) -> Result<Screenshot, String> {
    if width <= 0 || height <= 0 {
        return Err("the capture region is empty".to_string());
    }
    if (width as u64) * (height as u64) > MAX_PIXELS {
        return Err(format!("capture region too large: {width}x{height}"));
    }

    unsafe {
        let screen_dc = GetDC(HWND::default());
        if screen_dc.is_invalid() {
            return Err("could not open a device context for the screen".to_string());
        }
        let memory_dc = CreateCompatibleDC(screen_dc);
        let bitmap = CreateCompatibleBitmap(screen_dc, width, height);
        if bitmap.is_invalid() {
            let _ = DeleteDC(memory_dc);
            ReleaseDC(HWND::default(), screen_dc);
            return Err("could not allocate a bitmap for the capture".to_string());
        }

        let previous = SelectObject(memory_dc, bitmap);
        let copied = BitBlt(memory_dc, 0, 0, width, height, screen_dc, x, y, SRCCOPY);

        let mut header = BITMAPINFO::default();
        header.bmiHeader.biSize = size_of::<BITMAPINFOHEADER>() as u32;
        header.bmiHeader.biWidth = width;
        // Negative height asks for a top-down buffer, which is the order PNG wants.
        header.bmiHeader.biHeight = -height;
        header.bmiHeader.biPlanes = 1;
        header.bmiHeader.biBitCount = 32;
        header.bmiHeader.biCompression = BI_RGB_UNCOMPRESSED;

        let mut bgra = vec![0u8; (width as usize) * (height as usize) * 4];
        let lines = GetDIBits(
            memory_dc,
            bitmap,
            0,
            height as u32,
            Some(bgra.as_mut_ptr() as *mut core::ffi::c_void),
            &mut header,
            DIB_RGB_COLORS,
        );

        SelectObject(memory_dc, previous);
        let _ = DeleteObject(bitmap);
        let _ = DeleteDC(memory_dc);
        ReleaseDC(HWND::default(), screen_dc);

        if copied.is_err() || lines == 0 {
            return Err("the screen could not be captured (it may be locked)".to_string());
        }

        // GDI hands back BGRA with an unused alpha byte; force it opaque or the
        // image renders fully transparent.
        for pixel in bgra.chunks_exact_mut(4) {
            pixel.swap(0, 2);
            pixel[3] = 255;
        }

        Ok(Screenshot {
            width: width as u32,
            height: height as u32,
            rgba: bgra,
        })
    }
}

/// Nearest-neighbour scale so the long edge fits `max_edge`. Nearest-neighbour on
/// purpose: it is exact (no invented pixels between real ones), cheap, and for
/// reading a UI it loses nothing that matters.
fn downscale(shot: Screenshot, max_edge: u32) -> (Vec<u8>, u32, u32) {
    let long_edge = shot.width.max(shot.height);
    if long_edge <= max_edge {
        let (width, height) = (shot.width, shot.height);
        return (shot.rgba, width, height);
    }

    let ratio = max_edge as f64 / long_edge as f64;
    let width = ((shot.width as f64) * ratio).round().max(1.0) as u32;
    let height = ((shot.height as f64) * ratio).round().max(1.0) as u32;

    let mut out = vec![0u8; (width as usize) * (height as usize) * 4];
    let x_ratio = shot.width as f64 / width as f64;
    let y_ratio = shot.height as f64 / height as f64;

    for y in 0..height {
        let source_y = ((y as f64) * y_ratio) as u32;
        for x in 0..width {
            let source_x = ((x as f64) * x_ratio) as u32;
            let source =
                ((source_y.min(shot.height - 1) * shot.width + source_x.min(shot.width - 1)) * 4)
                    as usize;
            let target = ((y * width + x) * 4) as usize;
            out[target..target + 4].copy_from_slice(&shot.rgba[source..source + 4]);
        }
    }

    (out, width, height)
}

fn encode_png(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    let mut buffer = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut buffer, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|error| format!("could not start the PNG encoder: {error}"))?;
        writer
            .write_image_data(rgba)
            .map_err(|error| format!("could not encode the screenshot: {error}"))?;
        writer
            .finish()
            .map_err(|error| format!("could not finish the screenshot: {error}"))?;
    }
    Ok(buffer)
}
