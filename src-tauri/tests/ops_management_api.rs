//! 运营台账的 HTTP 契约测试。
//!
//! 覆盖真正在 CLI → Sidecar → Rust 之间流通的那份 JSON：字段名、patch 语义、
//! 落盘格式。管理 API 是真的 axum server，落盘是真的文件——不是 mock。
//!
//! 跑法：`cargo test --test ops_management_api`（Linux/macOS 直接跑；Windows
//! 用 `scripts/test_rust_windows.ps1`，裸 cargo test 会假绿）。

use std::sync::OnceLock;
use std::time::Duration;

use serde_json::{json, Value};

/// 管理 API 端口。整个进程只起一次——`start_management_api` 内部用 OnceLock
/// 记端口，第二次调用会直接失败。
fn management_port() -> u16 {
    static PORT: OnceLock<u16> = OnceLock::new();
    *PORT.get_or_init(|| {
        // 用全局 runtime 起服务：axum 的 listener 是绑在调用方 runtime 的 IO
        // driver 上的，serve task 也得在同一个 runtime 里跑，否则测试 runtime
        // 一析构，listener 就失去驱动了。
        tauri::async_runtime::block_on(app_lib::management_api::start_management_api())
            .expect("start management api")
    })
}

fn post(path: &str, body: Value) -> Value {
    let port = management_port();
    let url = format!("http://127.0.0.1:{}{}", port, path);
    let text = tauri::async_runtime::block_on(async move {
        // client 在 runtime 上下文里建——reqwest 的连接器要当前 runtime。
        let client = app_lib::local_http::json_client(Duration::from_secs(10));
        let response = client.post(&url).json(&body).send().await.expect("send");
        let status = response.status();
        let text = response.text().await.expect("read body");
        assert!(
            status.is_success(),
            "{} -> HTTP {}: {}",
            path,
            status.as_u16(),
            text
        );
        text
    });
    serde_json::from_str(&text).unwrap_or_else(|error| panic!("{} -> invalid json: {}", path, error))
}

/// 临时工作区。目录在测试结束时自动清理。
fn workspace() -> tempfile::TempDir {
    tempfile::TempDir::new().expect("temp dir")
}

/// canonical 后的工作区路径。store 写入时也会 canonicalize，用同一个路径读文件。
fn workspace_path(dir: &tempfile::TempDir) -> std::path::PathBuf {
    dir.path()
        .canonicalize()
        .expect("canonicalize workspace")
}

#[test]
fn ops_write_read_patch_delete_roundtrip() {
    let dir = workspace();
    let workspace = workspace_path(&dir);
    let workspace = workspace.to_string_lossy().into_owned();

    // 1. 新建一条选题——字段名与 CLI 发出的完全一致（camelCase，kind 在 item 里）。
    let created = post(
        "/api/ops/upsert",
        json!({
            "workspace": workspace,
            "item": {
                "kind": "topic",
                "title": "抖音·反差开场",
                "platform": "douyin",
                "tags": ["热点", "对比"],
                "sourceRefs": ["https://example.com/hot"]
            }
        }),
    );
    assert_eq!(created["ok"], json!(true), "upsert failed: {}", created);
    let id = created["id"]
        .as_str()
        .expect("upsert must return the affected record id")
        .to_string();
    assert!(id.starts_with("topic-"), "unexpected id: {}", id);

    // 2. 读回来——列表态是完整的。
    let read = post("/api/ops/read", json!({ "workspace": workspace }));
    assert_eq!(read["ok"], json!(true));
    assert_eq!(read["state"]["topics"][0]["title"], json!("抖音·反差开场"));
    assert_eq!(read["state"]["topics"][0]["tags"][1], json!("对比"));
    assert_eq!(read["state"]["topics"][0]["sourceRefs"][0], json!("https://example.com/hot"));

    // 3. 只改一个字段——其余字段不许被冲掉（patch 语义，不是整体替换）。
    let patched = post(
        "/api/ops/upsert",
        json!({
            "workspace": workspace,
            "item": { "kind": "topic", "id": id, "status": "planned" }
        }),
    );
    assert_eq!(patched["ok"], json!(true));
    let topic = &patched["state"]["topics"][0];
    assert_eq!(topic["status"], json!("planned"));
    assert_eq!(topic["title"], json!("抖音·反差开场"));
    assert_eq!(topic["tags"][0], json!("热点"));
    assert_eq!(topic["platform"], json!("douyin"));
    // 改字段不该改「何时创建」。
    assert_eq!(topic["createdAt"], patched["state"]["topics"][0]["createdAt"]);

    // 4. 落盘文件是合法 JSON，且人类可读（缩进过的多行）。
    let raw = std::fs::read_to_string(workspace_path(&dir).join("ops/state.json")).expect("state file");
    let parsed: Value = serde_json::from_str(&raw).expect("state file must be valid json");
    assert_eq!(parsed["topics"][0]["title"], json!("抖音·反差开场"));
    assert!(
        raw.contains("\n  \"topics\""),
        "state file must be pretty-printed:\n{}",
        raw
    );

    // 5. 删除——剩下的记录数归零。
    let deleted = post(
        "/api/ops/delete",
        json!({ "workspace": workspace, "kind": "topic", "id": id }),
    );
    assert_eq!(deleted["ok"], json!(true));
    assert_eq!(deleted["state"]["topics"].as_array().unwrap().len(), 0);
}

#[test]
fn ops_partial_review_update_keeps_other_metrics() {
    let dir = workspace();
    let workspace = workspace_path(&dir);
    let workspace = workspace.to_string_lossy().into_owned();

    let created = post(
        "/api/ops/upsert",
        json!({
            "workspace": workspace,
            "item": {
                "kind": "review",
                "assetId": "asset-1",
                "platform": "douyin",
                "publishedAt": "2026-11-01T10:00:00Z",
                "metrics": { "views": 100, "likes": 5, "comments": 1, "shares": 2, "saves": 3 }
            }
        }),
    );
    assert_eq!(created["ok"], json!(true), "upsert failed: {}", created);
    let id = created["id"].as_str().expect("id").to_string();

    // 只更新播放量——其余五个指标必须还在（深合并，不是整体替换）。
    let patched = post(
        "/api/ops/upsert",
        json!({
            "workspace": workspace,
            "item": { "kind": "review", "id": id, "metrics": { "views": 900 } }
        }),
    );
    assert_eq!(patched["ok"], json!(true));
    let metrics = &patched["state"]["reviews"][0]["metrics"];
    assert_eq!(metrics["views"], json!(900));
    assert_eq!(metrics["likes"], json!(5));
    assert_eq!(metrics["comments"], json!(1));
    assert_eq!(metrics["shares"], json!(2));
    assert_eq!(metrics["saves"], json!(3));
}

#[test]
fn ops_rejects_unknown_workspace() {
    let missing = post(
        "/api/ops/read",
        json!({ "workspace": "/nonexistent/ops-workspace-check" }),
    );
    assert_eq!(missing["ok"], json!(false));
    assert!(
        missing["error"].as_str().unwrap_or_default().contains("directory"),
        "unexpected error: {}",
        missing
    );
}
