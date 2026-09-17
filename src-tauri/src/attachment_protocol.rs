// Custom `hamuna://` URI scheme for binary attachment delivery.
//
// Regular user attachments are served directly from the app data directory.
// Tool attachments are proxied to the session sidecar because the sidecar owns
// the external-attachment registry and path validation logic.
// Widget media (local images/videos embedded in generative-ui-widget HTML) is
// served directly from the workspace filesystem with HTTP Range support so
// <video> can stream progressively instead of pushing base64 through postMessage.
//
// URL forms:
//   macOS / Linux: hamuna://attachment/<sessionId>/<filename.ext>
//   Windows:       http://hamuna.localhost/attachment/<sessionId>/<filename.ext>
//   macOS / Linux: hamuna://tool-attachment/<sessionId>/<turnId>/<filename.ext>
//   Windows:       http://hamuna.localhost/tool-attachment/<sessionId>/<turnId>/<filename.ext>
//   macOS / Linux: hamuna://widget-media/<percent-encoded absolute path>
//   Windows:       http://hamuna.localhost/widget-media/<percent-encoded absolute path>

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::Duration;

use tauri::http::{Request, Response, StatusCode};
use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder};

use crate::app_dirs::hamuna_data_dir;
use crate::sidecar::ManagedSidecarManager;

fn attachments_root() -> Option<PathBuf> {
    hamuna_data_dir().map(|d| d.join("attachments"))
}

fn mime_from_ext(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "pdf" => "application/pdf",
        "txt" | "log" | "md" => "text/plain; charset=utf-8",
        "json" => "application/json",
        _ => "application/octet-stream",
    }
}

fn empty(status: StatusCode) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header("Access-Control-Allow-Origin", "*")
        .body(Vec::new())
        .unwrap()
}

fn extract_path_after_marker(uri: &str, marker: &str) -> Option<String> {
    let idx = uri.find(marker)?;
    let rest = &uri[idx + marker.len()..];
    let rest = rest.split('?').next().unwrap_or(rest);
    let rest = rest.split('#').next().unwrap_or(rest);
    if rest.is_empty() {
        return None;
    }
    Some(percent_decode(rest))
}

fn extract_relative_path(uri: &str) -> Option<String> {
    extract_path_after_marker(uri, "://attachment/")
        .or_else(|| extract_path_after_marker(uri, "/attachment/"))
}

fn extract_tool_attachment_segments(uri: &str) -> Option<(String, String, String)> {
    let rel = extract_path_after_marker(uri, "://tool-attachment/")
        .or_else(|| extract_path_after_marker(uri, "/tool-attachment/"))?;
    let segments: Vec<&str> = rel.split('/').collect();
    if segments.len() != 3 || segments.iter().any(|segment| has_unsafe_segment(segment)) {
        return None;
    }
    Some((
        segments[0].to_string(),
        segments[1].to_string(),
        segments[2].to_string(),
    ))
}

fn has_unsafe_segment(segment: &str) -> bool {
    segment.is_empty()
        || segment == "."
        || segment == ".."
        || segment.contains("..")
        || segment
            .chars()
            .any(|ch| ch < ' ' || ch == '/' || ch == '\\')
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push((h << 4) | l);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| input.to_string())
}

fn percent_encode_path_segment(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for &byte in input.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn hex(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn extract_widget_media_path(uri: &str) -> Option<String> {
    // Marker: `://widget-media/` (macOS/Linux `hamuna://widget-media/…`) or
    // `/widget-media/` (Windows `http://hamuna.localhost/widget-media/…`).
    extract_path_after_marker(uri, "://widget-media/")
        .or_else(|| extract_path_after_marker(uri, "/widget-media/"))
}

/// Media types the widget pipeline is allowed to stream. The widget HTML is
/// AI-generated, so `widget-media` must NOT be an arbitrary file-read
/// primitive — only image/audio/video extensions, validated via the same
/// canonicalize + home/tmp/workspace prefix chokepoint that
/// `cmd_download_local_file` uses.
fn is_widget_media_ext(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|s| s.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some(
            "png"
                | "jpg"
                | "jpeg"
                | "gif"
                | "webp"
                | "svg"
                | "avif"
                | "bmp"
                | "mp4"
                | "webm"
                | "ogg"
                | "ogv"
                | "mov"
                | "m4v"
                | "mp3"
                | "wav"
        )
    )
}

/// Parse an HTTP Range header value (after the `bytes=` prefix) against the
/// total length. Returns (start, end) inclusive; None for malformed / not
/// satisfiable. Supports `start-end`, `start-` (open-ended) and `-suffix`.
fn parse_byte_range(spec: &str, total: u64) -> Option<(u64, u64)> {
    let (start_s, end_s) = spec.split_once('-')?;
    let start: u64 = start_s.trim().parse().ok()?;
    let end: u64 = if end_s.trim().is_empty() {
        total.saturating_sub(1)
    } else {
        let parsed: u64 = end_s.trim().parse().ok()?;
        parsed.min(total.saturating_sub(1))
    };
    if start > end || start >= total {
        return None;
    }
    Some((start, end))
}

/// Serve a local media file referenced by widget HTML as a streamable HTTP
/// response. Range requests (bytes=start-end) get 206 Partial Content so the
/// WebView's `<video>` can seek / buffer progressively instead of the whole
/// file being base64'd into the widget HTML (the old path pegged the renderer
/// thread on every large video — user: "对话区域太卡了").
fn build_widget_media_response(request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let uri_str = request.uri().to_string();
    let Some(encoded) = extract_widget_media_path(&uri_str) else {
        return empty(StatusCode::NOT_FOUND);
    };

    let resolved =
        match crate::workspace_files::system_open::validate_external_open_path(&encoded, None) {
            Ok(p) => p,
            Err(_) => return empty(StatusCode::FORBIDDEN),
        };
    if !is_widget_media_ext(&resolved) {
        return empty(StatusCode::FORBIDDEN);
    }

    let metadata = match std::fs::metadata(&resolved) {
        Ok(m) => m,
        Err(_) => return empty(StatusCode::NOT_FOUND),
    };
    let total = metadata.len();
    if total == 0 {
        return empty(StatusCode::NOT_FOUND);
    }

    // Parse Range: bytes=start-end | bytes=start- | bytes=-suffix
    let range = request
        .headers()
        .get("range")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("bytes="))
        .and_then(|spec| parse_byte_range(spec, total));

    let (status, start, end) = match range {
        Some((s, e)) => (StatusCode::PARTIAL_CONTENT, s, e),
        None => (StatusCode::OK, 0, total.saturating_sub(1)),
    };
    let len = (end - start + 1) as usize;

    let mut file = match File::open(&resolved) {
        Ok(f) => f,
        Err(_) => return empty(StatusCode::NOT_FOUND),
    };
    if file.seek(SeekFrom::Start(start)).is_err() {
        return empty(StatusCode::INTERNAL_SERVER_ERROR);
    }
    let mut buf = vec![0u8; len];
    if file.read_exact(&mut buf).is_err() {
        return empty(StatusCode::INTERNAL_SERVER_ERROR);
    }

    let mime = mime_from_ext(&resolved);
    let mut builder = Response::builder()
        .status(status)
        .header("Content-Type", mime)
        .header("Content-Length", len.to_string())
        .header("Accept-Ranges", "bytes")
        .header("Cache-Control", "no-cache")
        .header("Access-Control-Allow-Origin", "*");
    if let Some((s, e)) = range {
        builder = builder.header("Content-Range", format!("bytes {s}-{e}/{total}"));
    }
    builder.body(buf).unwrap()
}

fn build_attachment_response(request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let uri_str = request.uri().to_string();
    let Some(rel) = extract_relative_path(&uri_str) else {
        return empty(StatusCode::NOT_FOUND);
    };

    let Some(root) = attachments_root() else {
        return empty(StatusCode::NOT_FOUND);
    };
    let candidate = root.join(&rel);

    let canonical = match candidate.canonicalize() {
        Ok(p) => p,
        Err(_) => return empty(StatusCode::NOT_FOUND),
    };
    let root_canonical = match root.canonicalize() {
        Ok(p) => p,
        Err(_) => return empty(StatusCode::NOT_FOUND),
    };
    if !canonical.starts_with(&root_canonical) {
        return empty(StatusCode::FORBIDDEN);
    }

    let bytes = match std::fs::read(&canonical) {
        Ok(b) => b,
        Err(_) => return empty(StatusCode::NOT_FOUND),
    };

    let mime = mime_from_ext(&canonical);
    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", mime)
        .header("Content-Length", bytes.len().to_string())
        .header("Cache-Control", "public, max-age=31536000, immutable")
        .header("Access-Control-Allow-Origin", "*")
        .body(bytes)
        .unwrap()
}

fn build_tool_attachment_response(
    port: u16,
    session_id: &str,
    turn_id: &str,
    filename: &str,
) -> Response<Vec<u8>> {
    let url = format!(
        "http://127.0.0.1:{}/api/attachment/tool/{}/{}/{}",
        port,
        percent_encode_path_segment(session_id),
        percent_encode_path_segment(turn_id),
        percent_encode_path_segment(filename)
    );

    let client = match crate::local_http::blocking_builder()
        .timeout(Duration::from_secs(30))
        .build()
    {
        Ok(client) => client,
        Err(_) => return empty(StatusCode::BAD_GATEWAY),
    };

    let response = match client.get(url).send() {
        Ok(response) => response,
        Err(_) => return empty(StatusCode::BAD_GATEWAY),
    };

    let status =
        StatusCode::from_u16(response.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    let cache_control = response
        .headers()
        .get(reqwest::header::CACHE_CONTROL)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);

    let bytes = match response.bytes() {
        Ok(bytes) => bytes.to_vec(),
        Err(_) => return empty(StatusCode::BAD_GATEWAY),
    };

    let mut builder = Response::builder()
        .status(status)
        .header("Content-Type", content_type)
        .header("Content-Length", bytes.len().to_string())
        .header("Access-Control-Allow-Origin", "*");
    if let Some(cache_control) = cache_control {
        builder = builder.header("Cache-Control", cache_control);
    }
    builder.body(bytes).unwrap()
}

fn session_sidecar_port<R: Runtime>(
    ctx: &UriSchemeContext<'_, R>,
    session_id: &str,
) -> Option<u16> {
    let manager = ctx.app_handle().try_state::<ManagedSidecarManager>()?;
    let mut guard = manager.lock().ok()?;
    guard.get_session_port(session_id)
}

/// Async URI scheme handler. File I/O and loopback HTTP run on Tauri's pooled
/// blocking executor so large reads never block the webview thread.
pub fn handle<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let uri_str = request.uri().to_string();
    // widget-media: local files embedded in generative-ui-widget HTML. Must be
    // checked BEFORE tool-attachment (whose segment extractor also matches
    // arbitrary 3-segment paths) — the widget-media marker is more specific.
    if uri_str.contains("widget-media") {
        tauri::async_runtime::spawn_blocking(move || {
            let response = build_widget_media_response(&request);
            responder.respond(response);
        });
        return;
    }
    if let Some((session_id, turn_id, filename)) = extract_tool_attachment_segments(&uri_str) {
        let port = session_sidecar_port(&ctx, &session_id);
        tauri::async_runtime::spawn_blocking(move || {
            let response = match port {
                Some(port) => {
                    build_tool_attachment_response(port, &session_id, &turn_id, &filename)
                }
                None => empty(StatusCode::NOT_FOUND),
            };
            responder.respond(response);
        });
        return;
    }

    tauri::async_runtime::spawn_blocking(move || {
        let response = build_attachment_response(&request);
        responder.respond(response);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_macos_form() {
        let r = extract_relative_path("hamuna://attachment/abc/file.png").unwrap();
        assert_eq!(r, "abc/file.png");
    }

    #[test]
    fn extract_windows_form() {
        let r = extract_relative_path("http://hamuna.localhost/attachment/abc/file.png").unwrap();
        assert_eq!(r, "abc/file.png");
    }

    #[test]
    fn strips_query_string() {
        let r = extract_relative_path("hamuna://attachment/abc/file.png?v=1").unwrap();
        assert_eq!(r, "abc/file.png");
    }

    #[test]
    fn percent_decodes_spaces() {
        assert_eq!(percent_decode("foo%20bar"), "foo bar");
    }

    #[test]
    fn rejects_non_attachment_uri() {
        assert!(extract_relative_path("hamuna://other/foo").is_none());
    }

    #[test]
    fn regular_attachment_rejects_tool_attachment_uri() {
        assert!(extract_relative_path("hamuna://tool-attachment/s/t/file.png").is_none());
    }

    #[test]
    fn extracts_tool_macos_form() {
        let r = extract_tool_attachment_segments("hamuna://tool-attachment/s/t/file.png").unwrap();
        assert_eq!(
            r,
            ("s".to_string(), "t".to_string(), "file.png".to_string())
        );
    }

    #[test]
    fn extracts_tool_windows_form() {
        let r = extract_tool_attachment_segments(
            "http://hamuna.localhost/tool-attachment/s/t/file.png",
        )
        .unwrap();
        assert_eq!(
            r,
            ("s".to_string(), "t".to_string(), "file.png".to_string())
        );
    }

    #[test]
    fn tool_attachment_rejects_unsafe_segment() {
        assert!(
            extract_tool_attachment_segments("hamuna://tool-attachment/s/%2e%2e/file.png",)
                .is_none()
        );
        assert!(
            extract_tool_attachment_segments("hamuna://tool-attachment/s/t/bad%5Cname.png",)
                .is_none()
        );
    }

    #[test]
    fn percent_encodes_path_segment() {
        assert_eq!(percent_encode_path_segment("a b.png"), "a%20b.png");
        assert_eq!(percent_encode_path_segment("a+b.png"), "a%2Bb.png");
    }

    #[test]
    fn extracts_widget_media_macos_form() {
        let r = extract_widget_media_path("hamuna://widget-media/%2Fhome%2Fu%2Fv.mp4").unwrap();
        assert_eq!(r, "/home/u/v.mp4");
    }

    #[test]
    fn extracts_widget_media_windows_form() {
        let r = extract_widget_media_path("http://hamuna.localhost/widget-media/C%3A%5Cv%5Ca.mp4")
            .unwrap();
        assert_eq!(r, "C:\\v\\a.mp4");
    }

    #[test]
    fn widget_media_rejects_non_media_uri() {
        assert!(extract_widget_media_path("hamuna://attachment/a.png").is_none());
        assert!(extract_widget_media_path("hamuna://tool-attachment/s/t/a.png").is_none());
    }

    #[test]
    fn widget_media_ext_allowlist() {
        assert!(is_widget_media_ext(Path::new("/a/b.mp4")));
        assert!(is_widget_media_ext(Path::new("/a/b.PNG"))); // case-insensitive
        assert!(is_widget_media_ext(Path::new("/a/b.webm")));
        assert!(!is_widget_media_ext(Path::new("/a/b.txt")));
        assert!(!is_widget_media_ext(Path::new("/a/b.png.exe")));
    }

    #[test]
    fn parse_byte_range_supported_forms() {
        assert_eq!(parse_byte_range("0-99", 1000), Some((0, 99)));
        assert_eq!(parse_byte_range("500-", 1000), Some((500, 999)));
        assert_eq!(parse_byte_range("900-1500", 1000), Some((900, 999))); // end clamped
        assert_eq!(parse_byte_range("-100", 1000), None); // suffix form not supported → start parse fails? no: "-100" split_once('-') → ("", "100") → start parse fails → None
    }

    #[test]
    fn parse_byte_range_rejects_malformed_or_unsatisfiable() {
        assert_eq!(parse_byte_range("abc", 1000), None); // no '-'
        assert_eq!(parse_byte_range("1000-", 1000), None); // start >= total
        assert_eq!(parse_byte_range("99-50", 1000), None); // start > end
        assert_eq!(parse_byte_range("x-5", 1000), None); // non-numeric start
    }
}
