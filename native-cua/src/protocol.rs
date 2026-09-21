//! The JSONL envelope the shell speaks.
//!
//! One request per line on stdin, one response per line on stdout, each carrying
//! the caller's `id` back. Deliberately the same shape VesPi's other channels use
//! so the TypeScript side can stay boring.
//!
//! A failure is a response, never a crash: the shell asks for a screenshot of a
//! window that closed a moment ago, and the sidecar should say so and stay alive.

use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize)]
pub struct Request {
    #[serde(default)]
    pub id: Option<u64>,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

pub fn ok(id: Option<u64>, result: Value) -> Value {
    match id {
        Some(id) => serde_json::json!({ "id": id, "ok": true, "result": result }),
        None => serde_json::json!({ "ok": true, "result": result }),
    }
}

pub fn err(id: Option<u64>, message: impl Into<String>) -> Value {
    let message = message.into();
    match id {
        Some(id) => serde_json::json!({ "id": id, "ok": false, "error": message }),
        None => serde_json::json!({ "ok": false, "error": message }),
    }
}

/// Read a string parameter, trimmed, or `None` when absent/blank.
pub fn opt_string(params: &Value, key: &str) -> Option<String> {
    params
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

/// Read a required string parameter.
pub fn string(params: &Value, key: &str) -> Result<String, String> {
    opt_string(params, key).ok_or_else(|| format!("{key} is required"))
}

pub fn i64_or(params: &Value, key: &str, fallback: i64) -> i64 {
    params.get(key).and_then(Value::as_i64).unwrap_or(fallback)
}

pub fn u32_or(params: &Value, key: &str, fallback: u32) -> u32 {
    params
        .get(key)
        .and_then(Value::as_u64)
        .map(|value| value as u32)
        .unwrap_or(fallback)
}
