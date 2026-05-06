use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Result as IoResult};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Mutex, OnceLock};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tiny_http::{Header, Method, Response, Server, StatusCode};

const PORT: u16 = 19828;
const JSON_REQUEST_TIMEOUT_SECS: u64 = 10;

pub static NEXT_REQUEST_ID: AtomicU64 = AtomicU64::new(1);
static STREAM_REQUESTS: OnceLock<Mutex<HashMap<String, mpsc::Sender<BridgeStreamEvent>>>> =
    OnceLock::new();
static JSON_REQUESTS: OnceLock<Mutex<HashMap<String, mpsc::Sender<BridgeJsonResponse>>>> =
    OnceLock::new();

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BridgeStreamEvent {
    Token { text: String },
    References { references: Vec<BridgeReference> },
    Done { message: BridgeMessage },
    Error { code: String, message: String },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct BridgeReference {
    pub title: String,
    pub path: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct BridgeMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub timestamp: i64,
    #[serde(rename = "conversationId")]
    pub conversation_id: String,
    #[serde(default)]
    pub references: Vec<BridgeReference>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct IncomingStreamBody {
    project_path: String,
    message: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct BridgeJsonResponse {
    pub status: u16,
    pub body: Value,
}

pub fn format_sse_event(event: &BridgeStreamEvent) -> String {
    let event_name = match event {
        BridgeStreamEvent::Token { .. } => "token",
        BridgeStreamEvent::References { .. } => "references",
        BridgeStreamEvent::Done { .. } => "done",
        BridgeStreamEvent::Error { .. } => "error",
    };
    let data = serde_json::to_string(event).unwrap_or_else(|_| {
        r#"{"type":"error","code":"serialization_error","message":"Failed to serialize event"}"#
            .to_string()
    });

    format!("event: {event_name}\ndata: {data}\n\n")
}

pub struct SseReceiverReader {
    receiver: mpsc::Receiver<BridgeStreamEvent>,
    pending: Vec<u8>,
    finished: bool,
}

impl SseReceiverReader {
    pub fn new(receiver: mpsc::Receiver<BridgeStreamEvent>) -> Self {
        Self {
            receiver,
            pending: Vec::new(),
            finished: false,
        }
    }
}

impl Read for SseReceiverReader {
    fn read(&mut self, buf: &mut [u8]) -> IoResult<usize> {
        if buf.is_empty() {
            return Ok(0);
        }

        while self.pending.is_empty() && !self.finished {
            match self.receiver.recv_timeout(Duration::from_secs(15)) {
                Ok(event) => {
                    self.finished = matches!(
                        event,
                        BridgeStreamEvent::Done { .. } | BridgeStreamEvent::Error { .. }
                    );
                    self.pending = format_sse_event(&event).into_bytes();
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    self.pending = b": keep-alive\n\n".to_vec();
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    self.finished = true;
                }
            }
        }

        if self.pending.is_empty() {
            return Ok(0);
        }

        let n = buf.len().min(self.pending.len());
        buf[..n].copy_from_slice(&self.pending[..n]);
        self.pending.drain(..n);
        Ok(n)
    }
}

#[tauri::command]
pub fn web_bridge_emit_token(request_id: String, text: String) -> Result<(), String> {
    send_stream_event(request_id, BridgeStreamEvent::Token { text }, false)
}

#[tauri::command]
pub fn web_bridge_emit_references(
    request_id: String,
    references: Vec<BridgeReference>,
) -> Result<(), String> {
    send_stream_event(
        request_id,
        BridgeStreamEvent::References { references },
        false,
    )
}

#[tauri::command]
pub fn web_bridge_emit_done(request_id: String, message: BridgeMessage) -> Result<(), String> {
    send_stream_event(request_id, BridgeStreamEvent::Done { message }, true)
}

#[tauri::command]
pub fn web_bridge_emit_error(
    request_id: String,
    code: String,
    message: String,
) -> Result<(), String> {
    send_stream_event(
        request_id,
        BridgeStreamEvent::Error { code, message },
        true,
    )
}

#[tauri::command]
pub fn web_bridge_respond_json(
    request_id: String,
    status: u16,
    body: Value,
) -> Result<(), String> {
    let sender = json_requests()
        .lock()
        .map_err(|_| "json request registry lock poisoned".to_string())?
        .remove(&request_id)
        .ok_or_else(|| format!("Unknown JSON request id: {request_id}"))?;

    sender
        .send(BridgeJsonResponse { status, body })
        .map_err(|_| format!("JSON request receiver dropped: {request_id}"))
}

pub fn start_web_bridge(app: AppHandle) {
    thread::spawn(move || {
        let server = match Server::http(format!("127.0.0.1:{PORT}")) {
            Ok(server) => server,
            Err(error) => {
                eprintln!("[Web Bridge] Failed to bind 127.0.0.1:{PORT}: {error}");
                return;
            }
        };

        println!("[Web Bridge] Listening on http://127.0.0.1:{PORT}");
        for request in server.incoming_requests() {
            let app = app.clone();
            thread::spawn(move || handle_request(request, &app));
        }
    });
}

fn send_stream_event(
    request_id: String,
    event: BridgeStreamEvent,
    remove_after_send: bool,
) -> Result<(), String> {
    let sender = {
        let mut requests = stream_requests()
            .lock()
            .map_err(|_| "stream request registry lock poisoned".to_string())?;

        if remove_after_send {
            requests.remove(&request_id)
        } else {
            requests.get(&request_id).cloned()
        }
    }
    .ok_or_else(|| format!("Unknown stream request id: {request_id}"))?;

    sender.send(event).map_err(|_| {
        remove_stream_request(&request_id);
        format!("Stream request receiver dropped: {request_id}")
    })
}

fn stream_requests() -> &'static Mutex<HashMap<String, mpsc::Sender<BridgeStreamEvent>>> {
    STREAM_REQUESTS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn json_requests() -> &'static Mutex<HashMap<String, mpsc::Sender<BridgeJsonResponse>>> {
    JSON_REQUESTS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn next_request_id() -> String {
    NEXT_REQUEST_ID.fetch_add(1, Ordering::Relaxed).to_string()
}

fn handle_request(mut request: tiny_http::Request, app: &AppHandle) {
    let method = request.method().clone();
    let raw_url = request.url().to_string();
    let origin = request_origin(&request);
    let path = raw_url
        .split('?')
        .next()
        .unwrap_or(raw_url.as_str())
        .trim_matches('/')
        .to_string();
    let segments: Vec<&str> = if path.is_empty() {
        Vec::new()
    } else {
        path.split('/').collect()
    };

    if method == Method::Options {
        respond(request, 204, "", "application/json", origin.as_deref());
        return;
    }

    if method == Method::Get && segments.as_slice() == ["health"] {
        respond_json(
            request,
            200,
            json!({ "ok": true, "service": "llm-wiki-web-bridge", "version": "0.1.0" }),
            origin.as_deref(),
        );
        return;
    }

    match (method, segments.as_slice()) {
        (Method::Get, ["projects", project_id, "conversations"]) => {
            handle_json_bridge_request(
                request,
                app,
                "list_conversations",
                project_id,
                None,
                None,
                None,
                origin.as_deref(),
            );
        }
        (Method::Post, ["projects", project_id, "conversations"]) => {
            let body = Some(read_body(&mut request));
            handle_json_bridge_request(
                request,
                app,
                "create_conversation",
                project_id,
                None,
                None,
                body,
                origin.as_deref(),
            );
        }
        (Method::Get, ["projects", project_id, "conversations", conversation_id, "messages"]) => {
            handle_json_bridge_request(
                request,
                app,
                "list_messages",
                project_id,
                Some(conversation_id),
                None,
                None,
                origin.as_deref(),
            );
        }
        (
            Method::Post,
            [
                "projects",
                project_id,
                "conversations",
                conversation_id,
                "messages",
                message_id,
                "actions",
                action,
            ],
        ) => {
            if let Some(kind) = message_action_kind(action) {
                let body = Some(read_body(&mut request));
                handle_json_bridge_request(
                    request,
                    app,
                    kind,
                    project_id,
                    Some(conversation_id),
                    Some(message_id),
                    body,
                    origin.as_deref(),
                );
            } else {
                respond_json(
                    request,
                    404,
                    json!({ "ok": false, "error": "Not found" }),
                    origin.as_deref(),
                );
            }
        }
        (
            Method::Post,
            [
                "projects",
                project_id,
                "conversations",
                conversation_id,
                "messages",
                "stream",
            ],
        ) => {
            handle_stream_bridge_request(
                request,
                app,
                project_id,
                conversation_id,
                origin.as_deref(),
            );
        }
        _ => {
            respond_json(
                request,
                404,
                json!({ "ok": false, "error": "Not found" }),
                origin.as_deref(),
            );
        }
    }
}

fn handle_json_bridge_request(
    request: tiny_http::Request,
    app: &AppHandle,
    kind: &str,
    project_id: &str,
    conversation_id: Option<&str>,
    message_id: Option<&str>,
    body: Option<Result<Value, String>>,
    origin: Option<&str>,
) {
    let body = match body {
        Some(Ok(body)) => Some(body),
        Some(Err(error)) => {
            respond_json(request, 400, json!({ "ok": false, "error": error }), origin);
            return;
        }
        None => None,
    };

    let request_id = next_request_id();
    let (sender, receiver) = mpsc::channel();
    if let Err(error) = register_json_request(request_id.clone(), sender) {
        respond_json(request, 500, json!({ "ok": false, "error": error }), origin);
        return;
    }

    let payload = json!({
        "requestId": request_id,
        "kind": kind,
        "projectId": project_id,
        "conversationId": conversation_id,
        "messageId": message_id,
        "body": body,
    });

    if let Err(error) = app.emit("web-bridge:json-request", payload) {
        remove_json_request(&request_id);
        respond_json(
            request,
            500,
            json!({ "ok": false, "error": format!("Failed to emit web bridge JSON request: {error}") }),
            origin,
        );
        return;
    }

    match receiver.recv_timeout(Duration::from_secs(JSON_REQUEST_TIMEOUT_SECS)) {
        Ok(response) => respond_json(request, response.status, response.body, origin),
        Err(mpsc::RecvTimeoutError::Timeout) => {
            remove_json_request(&request_id);
            respond_json(
                request,
                504,
                json!({ "ok": false, "error": "Desktop response timed out" }),
                origin,
            );
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            remove_json_request(&request_id);
            respond_json(
                request,
                500,
                json!({ "ok": false, "error": "Desktop response channel disconnected" }),
                origin,
            );
        }
    }
}

fn handle_stream_bridge_request(
    mut request: tiny_http::Request,
    app: &AppHandle,
    project_id: &str,
    conversation_id: &str,
    origin: Option<&str>,
) {
    let body = match read_body(&mut request).and_then(parse_stream_body) {
        Ok(body) => body,
        Err(error) => {
            respond_json(request, 400, json!({ "ok": false, "error": error }), origin);
            return;
        }
    };

    let request_id = next_request_id();
    let (sender, receiver) = mpsc::channel();
    if let Err(error) = register_stream_request(request_id.clone(), sender) {
        respond_json(request, 500, json!({ "ok": false, "error": error }), origin);
        return;
    }

    let payload = json!({
        "requestId": request_id,
        "kind": "chat",
        "projectId": project_id,
        "conversationId": conversation_id,
        "projectPath": body.project_path,
        "message": body.message,
    });

    if let Err(error) = app.emit("web-bridge:chat-request", payload) {
        remove_stream_request(&request_id);
        respond_json(
            request,
            500,
            json!({ "ok": false, "error": format!("Failed to emit web bridge chat request: {error}") }),
            origin,
        );
        return;
    }

    let mut response = Response::new(
        StatusCode(200),
        sse_headers(),
        SseReceiverReader::new(receiver),
        None,
        None,
    );
    for header in cors_headers("text/event-stream", origin) {
        response.add_header(header);
    }
    let respond_result = request.respond(response);
    cancel_stream_request_if_active(app, &request_id);
    if let Err(error) = respond_result {
        eprintln!("[Web Bridge] Stream response failed for request {request_id}: {error}");
    }
}

fn read_body(request: &mut tiny_http::Request) -> Result<Value, String> {
    let mut body = String::new();
    if let Err(error) = request.as_reader().read_to_string(&mut body) {
        return Err(format!("Failed to read body: {error}"));
    }
    if body.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(&body).map_err(|error| format!("Invalid JSON body: {error}"))
}

fn parse_stream_body(body: Value) -> Result<IncomingStreamBody, String> {
    let object = body
        .as_object()
        .ok_or_else(|| "JSON body must be an object".to_string())?;

    let project_path = object
        .get("projectPath")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "projectPath must be a non-empty string".to_string())?
        .to_string();

    let message = object
        .get("message")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "message must be a non-empty string".to_string())?
        .to_string();

    Ok(IncomingStreamBody {
        project_path,
        message,
    })
}

fn message_action_kind(action: &str) -> Option<&'static str> {
    match action {
        "copy" => Some("copy_answer"),
        "save-to-wiki" => Some("save_answer_to_wiki"),
        "regenerate" => Some("regenerate_answer"),
        _ => None,
    }
}

fn register_stream_request(
    request_id: String,
    sender: mpsc::Sender<BridgeStreamEvent>,
) -> Result<(), String> {
    stream_requests()
        .lock()
        .map_err(|_| "stream request registry lock poisoned".to_string())?
        .insert(request_id, sender);
    Ok(())
}

fn register_json_request(
    request_id: String,
    sender: mpsc::Sender<BridgeJsonResponse>,
) -> Result<(), String> {
    json_requests()
        .lock()
        .map_err(|_| "json request registry lock poisoned".to_string())?
        .insert(request_id, sender);
    Ok(())
}

fn remove_stream_request(request_id: &str) -> bool {
    stream_requests()
        .lock()
        .map(|mut requests| requests.remove(request_id).is_some())
        .unwrap_or(false)
}

fn remove_json_request(request_id: &str) {
    if let Ok(mut requests) = json_requests().lock() {
        requests.remove(request_id);
    }
}

fn request_origin(request: &tiny_http::Request) -> Option<String> {
    request
        .headers()
        .iter()
        .find(|header| header.field.equiv("Origin"))
        .map(|header| header.value.as_str().to_string())
}

fn respond_json(request: tiny_http::Request, status: u16, body: Value, origin: Option<&str>) {
    respond(request, status, &body.to_string(), "application/json", origin);
}

fn respond(
    request: tiny_http::Request,
    status: u16,
    body: &str,
    content_type: &str,
    origin: Option<&str>,
) {
    let mut response = Response::from_string(body.to_string()).with_status_code(status);
    for header in cors_headers(content_type, origin) {
        response.add_header(header);
    }
    let _ = request.respond(response);
}

fn cors_headers(content_type: &str, origin: Option<&str>) -> Vec<Header> {
    let mut headers = vec![
        Header::from_bytes("Access-Control-Allow-Methods", "GET, POST, OPTIONS").unwrap(),
        Header::from_bytes("Access-Control-Allow-Headers", "Content-Type").unwrap(),
        Header::from_bytes("Content-Type", content_type).unwrap(),
    ];

    if let Some(origin) = origin.filter(|origin| is_allowed_origin(origin)) {
        headers.push(Header::from_bytes("Access-Control-Allow-Origin", origin).unwrap());
    }

    headers
}

fn is_allowed_origin(origin: &str) -> bool {
    let Some(host_and_port) = origin
        .strip_prefix("http://")
        .or_else(|| origin.strip_prefix("https://"))
    else {
        return false;
    };

    if host_and_port.contains('/') {
        return false;
    }

    for prefix in ["localhost:", "127.0.0.1:", "[::1]:"] {
        if let Some(port) = host_and_port.strip_prefix(prefix) {
            return is_valid_port(port);
        }
    }

    false
}

fn is_valid_port(port: &str) -> bool {
    !port.is_empty()
        && port
            .parse::<u16>()
            .map(|value| value > 0)
            .unwrap_or(false)
}

fn sse_headers() -> Vec<Header> {
    vec![
        Header::from_bytes("Cache-Control", "no-cache").unwrap(),
        Header::from_bytes("Connection", "keep-alive").unwrap(),
    ]
}

fn cancel_stream_request_if_active(app: &AppHandle, request_id: &str) {
    emit_cancel_if_removed(request_id, |payload| app.emit("web-bridge:stream-cancel", payload))
}

fn emit_cancel_if_removed<F, E>(request_id: &str, emit: F)
where
    F: FnOnce(Value) -> Result<(), E>,
    E: std::fmt::Display,
{
    if !remove_stream_request(request_id) {
        return;
    }

    if let Err(error) = emit(json!({ "requestId": request_id })) {
        eprintln!("[Web Bridge] Failed to emit stream cancel for request {request_id}: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_sse_format_includes_event_name_and_typed_json() {
        let sse = format_sse_event(&BridgeStreamEvent::Token {
            text: "hello".to_string(),
        });

        assert_eq!(sse, "event: token\ndata: {\"type\":\"token\",\"text\":\"hello\"}\n\n");
    }

    #[test]
    fn done_sse_contains_conversation_id_and_reference_path() {
        let sse = format_sse_event(&BridgeStreamEvent::Done {
            message: BridgeMessage {
                id: "m1".to_string(),
                role: "assistant".to_string(),
                content: "done".to_string(),
                timestamp: 1777334400000,
                conversation_id: "c1".to_string(),
                references: vec![BridgeReference {
                    title: "Doc".to_string(),
                    path: "F:\\wiki\\doc.md".to_string(),
                }],
            },
        });

        assert!(sse.starts_with("event: done\n"));
        assert!(sse.contains("\"type\":\"done\""));
        assert!(sse.contains("\"conversationId\":\"c1\""));
        assert!(sse.contains("\"path\":\"F:\\\\wiki\\\\doc.md\""));
        assert!(sse.contains("\"timestamp\":1777334400000"));
    }

    #[test]
    fn sse_receiver_reader_reads_token_then_done_then_eof() {
        let (sender, receiver) = mpsc::channel();
        sender
            .send(BridgeStreamEvent::Token {
                text: "abc".to_string(),
            })
            .unwrap();
        sender
            .send(BridgeStreamEvent::Done {
                message: BridgeMessage {
                    id: "m1".to_string(),
                    role: "assistant".to_string(),
                    content: "done".to_string(),
                    timestamp: 1777334400000,
                    conversation_id: "c1".to_string(),
                    references: Vec::new(),
                },
            })
            .unwrap();
        drop(sender);

        let mut reader = SseReceiverReader::new(receiver);
        let mut output = Vec::new();
        let mut small = [0_u8; 7];
        loop {
            let n = reader.read(&mut small).unwrap();
            if n == 0 {
                break;
            }
            output.extend_from_slice(&small[..n]);
        }

        let output = String::from_utf8(output).unwrap();
        assert!(output.contains("event: token\n"));
        assert!(output.contains("event: done\n"));
        assert_eq!(reader.read(&mut small).unwrap(), 0);
    }

    #[test]
    fn unknown_stream_request_id_returns_error() {
        let err = web_bridge_emit_token("missing-stream".to_string(), "hello".to_string())
            .expect_err("unknown stream id should fail");

        assert!(err.contains("Unknown stream request id"));
    }

    #[test]
    fn json_response_to_unknown_request_id_returns_error() {
        let err = web_bridge_respond_json("missing-json".to_string(), 200, json!({ "ok": true }))
            .expect_err("unknown JSON id should fail");

        assert!(err.contains("Unknown JSON request id"));
    }

    #[test]
    fn done_removes_stream_request_from_registry() {
        let request_id = "done-cleanup".to_string();
        let (sender, receiver) = mpsc::channel();
        register_stream_request(request_id.clone(), sender).unwrap();

        web_bridge_emit_done(
            request_id.clone(),
            BridgeMessage {
                id: "m1".to_string(),
                role: "assistant".to_string(),
                content: "done".to_string(),
                timestamp: 1777334400000,
                conversation_id: "c1".to_string(),
                references: Vec::new(),
            },
        )
        .unwrap();

        assert!(matches!(
            receiver.recv().unwrap(),
            BridgeStreamEvent::Done { .. }
        ));
        assert!(web_bridge_emit_token(request_id, "late".to_string()).is_err());
    }

    #[test]
    fn token_send_failure_removes_stream_request_from_registry() {
        let request_id = "token-send-failure-cleanup".to_string();
        let (sender, receiver) = mpsc::channel();
        register_stream_request(request_id.clone(), sender).unwrap();
        drop(receiver);

        let err = web_bridge_emit_token(request_id.clone(), "late".to_string())
            .expect_err("dropped stream receiver should fail");

        assert!(err.contains("Stream request receiver dropped"));
        let err = web_bridge_emit_token(request_id, "later".to_string())
            .expect_err("failed stream request should be removed");
        assert!(err.contains("Unknown stream request id"));
    }

    #[test]
    fn cancel_stream_request_removes_active_request_and_emits_payload() {
        let request_id = "cancel-active".to_string();
        let (sender, _receiver) = mpsc::channel();
        register_stream_request(request_id.clone(), sender).unwrap();
        let mut emitted = Vec::new();

        emit_cancel_if_removed(&request_id, |payload| {
            emitted.push(payload);
            Ok::<(), String>(())
        });

        assert_eq!(emitted, vec![json!({ "requestId": "cancel-active" })]);
        let err = web_bridge_emit_token(request_id, "late".to_string())
            .expect_err("canceled stream request should be removed");
        assert!(err.contains("Unknown stream request id"));
    }

    #[test]
    fn cancel_stream_request_does_not_emit_after_terminal_done_removed_request() {
        let request_id = "cancel-after-done".to_string();
        let (sender, receiver) = mpsc::channel();
        register_stream_request(request_id.clone(), sender).unwrap();

        web_bridge_emit_done(
            request_id.clone(),
            BridgeMessage {
                id: "m1".to_string(),
                role: "assistant".to_string(),
                content: "done".to_string(),
                timestamp: 1777334400000,
                conversation_id: "c1".to_string(),
                references: Vec::new(),
            },
        )
        .unwrap();
        assert!(matches!(
            receiver.recv().unwrap(),
            BridgeStreamEvent::Done { .. }
        ));

        let mut emitted = Vec::new();
        emit_cancel_if_removed(&request_id, |payload| {
            emitted.push(payload);
            Ok::<(), String>(())
        });

        assert!(emitted.is_empty());
    }

    #[test]
    fn is_allowed_origin_accepts_local_http_and_https_origins_with_ports() {
        for origin in [
            "http://localhost:5173",
            "https://localhost:5173",
            "http://127.0.0.1:3000",
            "https://127.0.0.1:3000",
            "http://[::1]:1420",
            "https://[::1]:1420",
        ] {
            assert!(is_allowed_origin(origin), "{origin} should be allowed");
        }
    }

    #[test]
    fn is_allowed_origin_rejects_external_or_malformed_origins() {
        for origin in [
            "http://example.com:5173",
            "https://localhost.evil.com:5173",
            "http://127.0.0.2:3000",
            "http://[::2]:1420",
            "http://localhost",
            "file://localhost:5173",
            "http://localhost:abc",
            "http://localhost:5173/path",
        ] {
            assert!(!is_allowed_origin(origin), "{origin} should be rejected");
        }
    }

    #[test]
    fn parse_stream_body_accepts_non_empty_project_path_and_message_strings() {
        let body = parse_stream_body(json!({
            "projectPath": "F:\\wiki",
            "message": "hello"
        }))
        .expect("valid stream body should parse");

        assert_eq!(
            body,
            IncomingStreamBody {
                project_path: "F:\\wiki".to_string(),
                message: "hello".to_string(),
            }
        );
    }

    #[test]
    fn parse_stream_body_rejects_non_object_body() {
        let err = parse_stream_body(Value::Null).expect_err("null body should fail");

        assert!(err.contains("JSON body must be an object"));
    }

    #[test]
    fn message_action_kind_maps_supported_action_segments() {
        assert_eq!(message_action_kind("copy"), Some("copy_answer"));
        assert_eq!(
            message_action_kind("save-to-wiki"),
            Some("save_answer_to_wiki")
        );
        assert_eq!(message_action_kind("regenerate"), Some("regenerate_answer"));
        assert_eq!(message_action_kind("delete"), None);
    }

    #[test]
    fn parse_stream_body_rejects_missing_empty_or_non_string_project_path() {
        for body in [
            json!({ "message": "hello" }),
            json!({ "projectPath": "", "message": "hello" }),
            json!({ "projectPath": "   ", "message": "hello" }),
            json!({ "projectPath": 123, "message": "hello" }),
        ] {
            let err = parse_stream_body(body).expect_err("invalid projectPath should fail");

            assert!(err.contains("projectPath must be a non-empty string"));
        }
    }

    #[test]
    fn parse_stream_body_rejects_missing_empty_or_non_string_message() {
        for body in [
            json!({ "projectPath": "F:\\wiki" }),
            json!({ "projectPath": "F:\\wiki", "message": "" }),
            json!({ "projectPath": "F:\\wiki", "message": "   " }),
            json!({ "projectPath": "F:\\wiki", "message": null }),
            json!({ "projectPath": "F:\\wiki", "message": 123 }),
        ] {
            let err = parse_stream_body(body).expect_err("invalid message should fail");

            assert!(err.contains("message must be a non-empty string"));
        }
    }

    #[test]
    fn error_removes_stream_request_from_registry() {
        let request_id = "error-cleanup".to_string();
        let (sender, receiver) = mpsc::channel();
        register_stream_request(request_id.clone(), sender).unwrap();

        web_bridge_emit_error(
            request_id.clone(),
            "failed".to_string(),
            "Something failed".to_string(),
        )
        .unwrap();

        assert!(matches!(
            receiver.recv().unwrap(),
            BridgeStreamEvent::Error { .. }
        ));
        assert!(web_bridge_emit_token(request_id, "late".to_string()).is_err());
    }
}
