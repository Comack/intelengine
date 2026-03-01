#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::env;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use keyring::Entry;
use reqwest::Url;
use serde::Serialize;
use serde_json::{Map, Value};
use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};

const LOCAL_API_PORT: &str = "46123";
const KEYRING_SERVICE: &str = "world-monitor";
const LOCAL_API_LOG_FILE: &str = "local-api.log";
const DESKTOP_LOG_FILE: &str = "desktop.log";
const LINUX_WEBKIT_SAFE_MODE_ENV: &str = "WM_LINUX_WEBKIT_SAFE_MODE";
const WEBKIT_DMABUF_ENV: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";
const MENU_FILE_SETTINGS_ID: &str = "file.settings";
const MENU_HELP_GITHUB_ID: &str = "help.github";
const MENU_HELP_DEVTOOLS_ID: &str = "help.devtools";
const SUPPORTED_SECRET_KEYS: [&str; 25] = [
    "GROQ_API_KEY",
    "OPENROUTER_API_KEY",
    "FRED_API_KEY",
    "EIA_API_KEY",
    "CLOUDFLARE_API_TOKEN",
    "ACLED_ACCESS_TOKEN",
    "URLHAUS_AUTH_KEY",
    "OTX_API_KEY",
    "ABUSEIPDB_API_KEY",
    "WINGBITS_API_KEY",
    "WS_RELAY_URL",
    "VITE_OPENSKY_RELAY_URL",
    "OPENSKY_CLIENT_ID",
    "OPENSKY_CLIENT_SECRET",
    "AISSTREAM_API_KEY",
    "VITE_WS_RELAY_URL",
    "FINNHUB_API_KEY",
    "NASA_FIRMS_API_KEY",
    "OLLAMA_API_URL",
    "OLLAMA_MODEL",
    "WORLDMONITOR_API_KEY",
    "PORTCAST_API_KEY",
    "GLOBAL_FISHING_WATCH_API_KEY",
    "ELECTRICITY_MAPS_API_KEY",
    "LIVEUAMAP_API_KEY",
];

#[derive(Clone, Debug, PartialEq, Eq)]
struct LinuxWebkitEnvPolicy {
    session: String,
    xdg_session_type: Option<String>,
    wayland_display: Option<String>,
    x11_display: Option<String>,
    safe_mode_enabled: bool,
    existing_dmabuf_value: Option<String>,
    applied_dmabuf_disable: bool,
    decision_reason: String,
}

#[derive(Default)]
struct LocalApiState {
    child: Mutex<Option<Child>>,
    token: Mutex<Option<String>>,
}

/// In-memory cache for keychain secrets. Populated once at startup to avoid
/// repeated macOS Keychain prompts (each `Entry::get_password()` triggers one).
struct SecretsCache {
    secrets: Mutex<HashMap<String, String>>,
}

impl SecretsCache {
    fn load_from_keychain() -> Self {
        // Try consolidated vault first — single keychain prompt
        if let Ok(entry) = Entry::new(KEYRING_SERVICE, "secrets-vault") {
            if let Ok(json) = entry.get_password() {
                if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(&json) {
                    let secrets: HashMap<String, String> = map
                        .into_iter()
                        .filter(|(k, v)| {
                            SUPPORTED_SECRET_KEYS.contains(&k.as_str()) && !v.trim().is_empty()
                        })
                        .map(|(k, v)| (k, v.trim().to_string()))
                        .collect();
                    return SecretsCache {
                        secrets: Mutex::new(secrets),
                    };
                }
            }
        }

        // Migration: read individual keys (old format), consolidate into vault.
        // This triggers one keychain prompt per key — happens only once.
        let mut secrets = HashMap::new();
        for key in SUPPORTED_SECRET_KEYS.iter() {
            if let Ok(entry) = Entry::new(KEYRING_SERVICE, key) {
                if let Ok(value) = entry.get_password() {
                    let trimmed = value.trim().to_string();
                    if !trimmed.is_empty() {
                        secrets.insert((*key).to_string(), trimmed);
                    }
                }
            }
        }

        // Write consolidated vault and clean up individual entries
        if !secrets.is_empty() {
            if let Ok(json) = serde_json::to_string(&secrets) {
                if let Ok(vault_entry) = Entry::new(KEYRING_SERVICE, "secrets-vault") {
                    if vault_entry.set_password(&json).is_ok() {
                        for key in SUPPORTED_SECRET_KEYS.iter() {
                            if let Ok(entry) = Entry::new(KEYRING_SERVICE, key) {
                                let _ = entry.delete_credential();
                            }
                        }
                    }
                }
            }
        }

        SecretsCache {
            secrets: Mutex::new(secrets),
        }
    }
}

#[derive(Serialize)]
struct DesktopRuntimeInfo {
    os: String,
    arch: String,
}

fn save_vault(cache: &HashMap<String, String>) -> Result<(), String> {
    let json =
        serde_json::to_string(cache).map_err(|e| format!("Failed to serialize vault: {e}"))?;
    let entry = Entry::new(KEYRING_SERVICE, "secrets-vault")
        .map_err(|e| format!("Keyring init failed: {e}"))?;
    entry
        .set_password(&json)
        .map_err(|e| format!("Failed to write vault: {e}"))?;
    Ok(())
}

fn generate_local_token() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let state = RandomState::new();
    let mut h1 = state.build_hasher();
    h1.write_u64(std::process::id() as u64);
    let a = h1.finish();
    let mut h2 = state.build_hasher();
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    h2.write_u128(nanos);
    let b = h2.finish();
    format!("{a:016x}{b:016x}")
}

#[tauri::command]
fn get_local_api_token(state: tauri::State<'_, LocalApiState>) -> Result<String, String> {
    let token = state
        .token
        .lock()
        .map_err(|_| "Failed to lock local API token".to_string())?;
    token
        .clone()
        .ok_or_else(|| "Token not generated".to_string())
}

#[tauri::command]
fn get_desktop_runtime_info() -> DesktopRuntimeInfo {
    DesktopRuntimeInfo {
        os: env::consts::OS.to_string(),
        arch: env::consts::ARCH.to_string(),
    }
}

#[tauri::command]
fn list_supported_secret_keys() -> Vec<String> {
    SUPPORTED_SECRET_KEYS
        .iter()
        .map(|key| (*key).to_string())
        .collect()
}

#[tauri::command]
fn get_secret(
    key: String,
    cache: tauri::State<'_, SecretsCache>,
) -> Result<Option<String>, String> {
    if !SUPPORTED_SECRET_KEYS.contains(&key.as_str()) {
        return Err(format!("Unsupported secret key: {key}"));
    }
    let secrets = cache
        .secrets
        .lock()
        .map_err(|_| "Lock poisoned".to_string())?;
    Ok(secrets.get(&key).cloned())
}

#[tauri::command]
fn get_all_secrets(cache: tauri::State<'_, SecretsCache>) -> HashMap<String, String> {
    cache
        .secrets
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

#[tauri::command]
fn set_secret(
    key: String,
    value: String,
    cache: tauri::State<'_, SecretsCache>,
) -> Result<(), String> {
    if !SUPPORTED_SECRET_KEYS.contains(&key.as_str()) {
        return Err(format!("Unsupported secret key: {key}"));
    }
    let mut secrets = cache
        .secrets
        .lock()
        .map_err(|_| "Lock poisoned".to_string())?;
    let trimmed = value.trim().to_string();
    // Build proposed state, persist first, then commit to cache
    let mut proposed = secrets.clone();
    if trimmed.is_empty() {
        proposed.remove(&key);
    } else {
        proposed.insert(key, trimmed);
    }
    save_vault(&proposed)?;
    *secrets = proposed;
    Ok(())
}

#[tauri::command]
fn delete_secret(key: String, cache: tauri::State<'_, SecretsCache>) -> Result<(), String> {
    if !SUPPORTED_SECRET_KEYS.contains(&key.as_str()) {
        return Err(format!("Unsupported secret key: {key}"));
    }
    let mut secrets = cache
        .secrets
        .lock()
        .map_err(|_| "Lock poisoned".to_string())?;
    let mut proposed = secrets.clone();
    proposed.remove(&key);
    save_vault(&proposed)?;
    *secrets = proposed;
    Ok(())
}

fn cache_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create app data directory {}: {e}", dir.display()))?;
    Ok(dir.join("persistent-cache.json"))
}

#[tauri::command]
fn read_cache_entry(app: AppHandle, key: String) -> Result<Option<Value>, String> {
    let path = cache_file_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }

    let contents = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read cache store {}: {e}", path.display()))?;
    let parsed: Value =
        serde_json::from_str(&contents).unwrap_or_else(|_| Value::Object(Map::new()));
    let Some(root) = parsed.as_object() else {
        return Ok(None);
    };

    Ok(root.get(&key).cloned())
}

#[tauri::command]
fn write_cache_entry(app: AppHandle, key: String, value: String) -> Result<(), String> {
    let path = cache_file_path(&app)?;

    let mut root: Map<String, Value> = if path.exists() {
        let contents = std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read cache store {}: {e}", path.display()))?;
        serde_json::from_str::<Value>(&contents)
            .ok()
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default()
    } else {
        Map::new()
    };

    let parsed_value: Value =
        serde_json::from_str(&value).map_err(|e| format!("Invalid cache payload JSON: {e}"))?;
    root.insert(key, parsed_value);

    let serialized = serde_json::to_string_pretty(&Value::Object(root))
        .map_err(|e| format!("Failed to serialize cache store: {e}"))?;
    std::fs::write(&path, serialized)
        .map_err(|e| format!("Failed to write cache store {}: {e}", path.display()))
}

fn logs_dir_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("Failed to resolve app log dir: {e}"))?;
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create app log dir {}: {e}", dir.display()))?;
    Ok(dir)
}

fn sidecar_log_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(logs_dir_path(app)?.join(LOCAL_API_LOG_FILE))
}

fn desktop_log_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(logs_dir_path(app)?.join(DESKTOP_LOG_FILE))
}

fn append_desktop_log(app: &AppHandle, level: &str, message: &str) {
    let Ok(path) = desktop_log_path(app) else {
        return;
    };

    let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) else {
        return;
    };

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let _ = writeln!(file, "[{timestamp}][{level}] {message}");
}

fn log_startup_stage(app: &AppHandle, stage: &str, details: &str) {
    let suffix = if details.trim().is_empty() {
        String::new()
    } else {
        format!(" {}", details.trim())
    };
    append_desktop_log(app, "INFO", &format!("startup stage={stage}{suffix}"));
}

fn read_trimmed_env_var(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn env_value_is_false(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "0" | "false" | "off" | "no"
    )
}

fn detect_linux_session(
    xdg_session_type: Option<&str>,
    wayland_display: Option<&str>,
    x11_display: Option<&str>,
) -> String {
    let normalized = xdg_session_type
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_ascii_lowercase);

    if matches!(normalized.as_deref(), Some("wayland")) || wayland_display.is_some() {
        return "wayland".to_string();
    }

    if matches!(normalized.as_deref(), Some("x11")) || x11_display.is_some() {
        return "x11".to_string();
    }

    if let Some(session) = normalized {
        return session;
    }

    "unknown".to_string()
}

fn compute_linux_webkit_policy(
    xdg_session_type: Option<String>,
    wayland_display: Option<String>,
    x11_display: Option<String>,
    safe_mode_override: Option<String>,
    existing_dmabuf_value: Option<String>,
) -> LinuxWebkitEnvPolicy {
    let session = detect_linux_session(
        xdg_session_type.as_deref(),
        wayland_display.as_deref(),
        x11_display.as_deref(),
    );
    let safe_mode_enabled = safe_mode_override
        .as_deref()
        .map(|value| !env_value_is_false(value))
        .unwrap_or(true);
    let wayland_detected = session == "wayland";

    let (applied_dmabuf_disable, decision_reason) = if !wayland_detected {
        (
            false,
            format!("session={session}; no automatic WebKit DMABUF override"),
        )
    } else if !safe_mode_enabled {
        (
            false,
            format!("{LINUX_WEBKIT_SAFE_MODE_ENV} disabled automatic Wayland WebKit safeguards"),
        )
    } else if let Some(existing) = existing_dmabuf_value.as_deref() {
        (
            false,
            format!("{WEBKIT_DMABUF_ENV} already set to {existing}"),
        )
    } else {
        (
            true,
            format!(
                "Wayland detected with no {WEBKIT_DMABUF_ENV}; applying conservative WebKit renderer defaults"
            ),
        )
    };

    LinuxWebkitEnvPolicy {
        session,
        xdg_session_type,
        wayland_display,
        x11_display,
        safe_mode_enabled,
        existing_dmabuf_value,
        applied_dmabuf_disable,
        decision_reason,
    }
}

#[cfg(target_os = "linux")]
fn apply_linux_webkit_env_policy() -> Option<LinuxWebkitEnvPolicy> {
    let xdg_session_type = read_trimmed_env_var("XDG_SESSION_TYPE");
    let wayland_display = read_trimmed_env_var("WAYLAND_DISPLAY");
    let x11_display = read_trimmed_env_var("DISPLAY");
    let safe_mode_override = read_trimmed_env_var(LINUX_WEBKIT_SAFE_MODE_ENV);
    let existing_dmabuf_value = read_trimmed_env_var(WEBKIT_DMABUF_ENV);

    let policy = compute_linux_webkit_policy(
        xdg_session_type,
        wayland_display,
        x11_display,
        safe_mode_override,
        existing_dmabuf_value,
    );

    if policy.applied_dmabuf_disable {
        env::set_var(WEBKIT_DMABUF_ENV, "1");
    }
    if policy.safe_mode_enabled {
        // Always ensure sandbox is disabled on Wayland in safe mode.
        if policy.session == "wayland" {
            env::set_var("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS", "1");
        }
        // Clear ALL GStreamer path variables — both the plain names and the
        // GStreamer 1.0-specific _1_0-suffixed names. The linuxdeploy GStreamer
        // plugin hook sets the _1_0 variants; GStreamer reads those preferentially.
        // Failing to clear them causes WebKit to find no plugins and crash.
        for var in &[
            "GST_PLUGIN_PATH",
            "GST_PLUGIN_PATH_1_0",
            "GST_PLUGIN_SCANNER",
            "GST_PLUGIN_SCANNER_1_0",
            "GST_REGISTRY_1_0",
            "GST_PLUGIN_SYSTEM_PATH_1_0",
            "GST_PTP_HELPER_1_0",
            "GST_REGISTRY_REUSE_PLUGIN_SCANNER",
        ] {
            env::remove_var(var);
        }
    }

    // Blacklist the ONNX GStreamer plugin — on Arch/CachyOS it fails to dlopen due to an
    // ABI version mismatch with the installed libonnxruntime.so and emits a WARNING on every
    // startup. The app's ML inference uses onnxruntime-web (WASM); the system library is unused.
    env::set_var("GST_PLUGIN_BLACKLIST", "onnx");

    Some(policy)
}

#[cfg(not(target_os = "linux"))]
fn apply_linux_webkit_env_policy() -> Option<LinuxWebkitEnvPolicy> {
    None
}

fn format_linux_webkit_policy(policy: &LinuxWebkitEnvPolicy) -> String {
    let xdg_session_type = policy.xdg_session_type.as_deref().unwrap_or("-");
    let wayland_display = policy.wayland_display.as_deref().unwrap_or("-");
    let x11_display = policy.x11_display.as_deref().unwrap_or("-");
    let existing_dmabuf = policy.existing_dmabuf_value.as_deref().unwrap_or("-");
    format!(
        "linux_webkit_policy session={} xdg_session_type={} wayland_display={} display={} safe_mode_enabled={} existing_dmabuf={} applied_dmabuf_disable={} reason=\"{}\"",
        policy.session,
        xdg_session_type,
        wayland_display,
        x11_display,
        policy.safe_mode_enabled,
        existing_dmabuf,
        policy.applied_dmabuf_disable,
        policy.decision_reason
    )
}

fn open_in_shell(arg: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut cmd = Command::new("open");
        cmd.arg(arg);
        cmd
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut cmd = Command::new("explorer");
        cmd.arg(arg);
        cmd
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut cmd = Command::new("xdg-open");
        cmd.arg(arg);
        cmd
    };

    command
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to open {}: {e}", arg))
}

fn open_path_in_shell(path: &Path) -> Result<(), String> {
    open_in_shell(&path.to_string_lossy())
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|_| "Invalid URL".to_string())?;

    match parsed.scheme() {
        "https" => open_in_shell(parsed.as_str()),
        "http" => match parsed.host_str() {
            Some("localhost") | Some("127.0.0.1") => open_in_shell(parsed.as_str()),
            _ => Err("Only https:// URLs are allowed (http:// only for localhost)".to_string()),
        },
        _ => Err("Only https:// URLs are allowed (http:// only for localhost)".to_string()),
    }
}

fn open_logs_folder_impl(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = logs_dir_path(app)?;
    open_path_in_shell(&dir)?;
    Ok(dir)
}

fn open_sidecar_log_impl(app: &AppHandle) -> Result<PathBuf, String> {
    let log_path = sidecar_log_path(app)?;
    if !log_path.exists() {
        File::create(&log_path)
            .map_err(|e| format!("Failed to create sidecar log {}: {e}", log_path.display()))?;
    }
    open_path_in_shell(&log_path)?;
    Ok(log_path)
}

#[tauri::command]
fn open_logs_folder(app: AppHandle) -> Result<String, String> {
    open_logs_folder_impl(&app).map(|path| path.display().to_string())
}

#[tauri::command]
fn open_sidecar_log_file(app: AppHandle) -> Result<String, String> {
    open_sidecar_log_impl(&app).map(|path| path.display().to_string())
}

#[tauri::command]
async fn open_settings_window_command(app: AppHandle) -> Result<(), String> {
    open_settings_window(&app)
}

#[tauri::command]
fn close_settings_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("settings") {
        window
            .close()
            .map_err(|e| format!("Failed to close settings window: {e}"))?;
    }
    Ok(())
}

const RUNTIME_PREFS_FILE: &str = "runtime-prefs.json";

fn runtime_prefs_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create app data directory {}: {e}", dir.display()))?;
    Ok(dir.join(RUNTIME_PREFS_FILE))
}

fn read_runtime_prefs(app: &AppHandle) -> Map<String, Value> {
    let Ok(path) = runtime_prefs_path(app) else { return Map::new() };
    if !path.exists() { return Map::new() }
    let Ok(contents) = std::fs::read_to_string(&path) else { return Map::new() };
    serde_json::from_str::<Value>(&contents)
        .ok()
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default()
}

fn write_runtime_prefs(app: &AppHandle, prefs: &Map<String, Value>) -> Result<(), String> {
    let path = runtime_prefs_path(app)?;
    let serialized = serde_json::to_string_pretty(&Value::Object(prefs.clone()))
        .map_err(|e| format!("Failed to serialize runtime prefs: {e}"))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &serialized)
        .map_err(|e| format!("Failed to write prefs tmp {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, &path)
        .map_err(|e| format!("Failed to rename prefs {}: {e}", path.display()))
}

#[tauri::command]
fn get_local_first_mode(app: AppHandle) -> bool {
    let prefs = read_runtime_prefs(&app);
    prefs.get("localFirst")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

#[tauri::command]
fn set_local_first_mode(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut prefs = read_runtime_prefs(&app);
    prefs.insert("localFirst".to_string(), Value::Bool(enabled));
    write_runtime_prefs(&app, &prefs)?;
    // Restart sidecar with updated LOCAL_API_LOCAL_FIRST env var
    stop_local_api(&app);
    start_local_api(&app)
}

/// Fetch JSON from Polymarket Gamma API using native TLS (bypasses Cloudflare JA3 blocking).
/// Called from frontend when browser CORS and sidecar Node.js TLS both fail.
#[tauri::command]
async fn fetch_polymarket(path: String, params: String) -> Result<String, String> {
    let allowed = ["events", "markets", "tags"];
    let segment = path.trim_start_matches('/');
    if !allowed.iter().any(|a| segment.starts_with(a)) {
        return Err("Invalid Polymarket path".into());
    }
    let url = format!("https://gamma-api.polymarket.com/{}?{}", segment, params);
    let client = reqwest::Client::builder()
        .use_native_tls()
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;
    let resp = client
        .get(&url)
        .header("Accept", "application/json")
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Polymarket fetch failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Polymarket HTTP {}", resp.status()));
    }
    resp.text()
        .await
        .map_err(|e| format!("Read body failed: {e}"))
}

fn open_settings_window(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.show();
        window
            .set_focus()
            .map_err(|e| format!("Failed to focus settings window: {e}"))?;
        return Ok(());
    }

    let _settings_window =
        WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("settings.html".into()))
            .title("World Monitor Settings")
            .inner_size(980.0, 760.0)
            .min_inner_size(820.0, 620.0)
            .resizable(true)
            .build()
            .map_err(|e| format!("Failed to create settings window: {e}"))?;

    // On Windows/Linux, menus are per-window. Remove the inherited app menu
    // from the settings window (macOS uses a shared app-wide menu bar instead).
    #[cfg(not(target_os = "macos"))]
    let _ = _settings_window.remove_menu();

    Ok(())
}

fn build_app_menu(handle: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let settings_item = MenuItem::with_id(
        handle,
        MENU_FILE_SETTINGS_ID,
        "Settings...",
        true,
        Some("CmdOrCtrl+,"),
    )?;
    let separator = PredefinedMenuItem::separator(handle)?;
    let quit_item = PredefinedMenuItem::quit(handle, Some("Quit"))?;
    let file_menu = Submenu::with_items(
        handle,
        "File",
        true,
        &[&settings_item, &separator, &quit_item],
    )?;

    let about_metadata = AboutMetadata {
        name: Some("World Monitor".into()),
        version: Some(env!("CARGO_PKG_VERSION").into()),
        copyright: Some("\u{00a9} 2025 Elie Habib".into()),
        website: Some("https://worldmonitor.app".into()),
        website_label: Some("worldmonitor.app".into()),
        ..Default::default()
    };
    let about_item =
        PredefinedMenuItem::about(handle, Some("About World Monitor"), Some(about_metadata))?;
    let github_item = MenuItem::with_id(
        handle,
        MENU_HELP_GITHUB_ID,
        "GitHub Repository",
        true,
        None::<&str>,
    )?;
    let devtools_item = MenuItem::with_id(
        handle,
        MENU_HELP_DEVTOOLS_ID,
        "Toggle Developer Tools",
        true,
        Some("CmdOrCtrl+Alt+I"),
    )?;
    let help_separator = PredefinedMenuItem::separator(handle)?;
    let help_menu = Submenu::with_items(
        handle,
        "Help",
        true,
        &[&about_item, &help_separator, &github_item, &devtools_item],
    )?;

    let edit_menu = {
        let undo = PredefinedMenuItem::undo(handle, None)?;
        let redo = PredefinedMenuItem::redo(handle, None)?;
        let sep1 = PredefinedMenuItem::separator(handle)?;
        let cut = PredefinedMenuItem::cut(handle, None)?;
        let copy = PredefinedMenuItem::copy(handle, None)?;
        let paste = PredefinedMenuItem::paste(handle, None)?;
        let select_all = PredefinedMenuItem::select_all(handle, None)?;
        Submenu::with_items(
            handle,
            "Edit",
            true,
            &[&undo, &redo, &sep1, &cut, &copy, &paste, &select_all],
        )?
    };

    Menu::with_items(handle, &[&file_menu, &edit_menu, &help_menu])
}

fn handle_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    match event.id().as_ref() {
        MENU_FILE_SETTINGS_ID => {
            if let Err(err) = open_settings_window(app) {
                append_desktop_log(app, "ERROR", &format!("settings menu failed: {err}"));
                eprintln!("[tauri] settings menu failed: {err}");
            }
        }
        MENU_HELP_GITHUB_ID => {
            let _ = open_in_shell("https://github.com/koala73/worldmonitor");
        }
        MENU_HELP_DEVTOOLS_ID => {
            if let Some(window) = app.get_webview_window("main") {
                if window.is_devtools_open() {
                    window.close_devtools();
                } else {
                    window.open_devtools();
                }
            }
        }
        _ => {}
    }
}

/// Strip Windows extended-length path prefixes that `canonicalize()` adds.
/// Preserve UNC semantics: `\\?\UNC\server\share\...` must become
/// `\\server\share\...` (not `UNC\server\share\...`).
fn sanitize_path_for_node(p: &Path) -> String {
    let s = p.to_string_lossy();
    if let Some(stripped_unc) = s.strip_prefix("\\\\?\\UNC\\") {
        format!("\\\\{stripped_unc}")
    } else if let Some(stripped) = s.strip_prefix("\\\\?\\") {
        stripped.to_string()
    } else {
        s.into_owned()
    }
}

#[cfg(test)]
mod sanitize_path_tests {
    use super::sanitize_path_for_node;
    use std::path::Path;

    #[test]
    fn strips_extended_drive_prefix() {
        let raw = Path::new(r"\\?\C:\Program Files\nodejs\node.exe");
        assert_eq!(
            sanitize_path_for_node(raw),
            r"C:\Program Files\nodejs\node.exe".to_string()
        );
    }

    #[test]
    fn strips_extended_unc_prefix_and_preserves_unc_root() {
        let raw = Path::new(r"\\?\UNC\server\share\sidecar\local-api-server.mjs");
        assert_eq!(
            sanitize_path_for_node(raw),
            r"\\server\share\sidecar\local-api-server.mjs".to_string()
        );
    }

    #[test]
    fn leaves_standard_paths_unchanged() {
        let raw = Path::new(r"C:\Users\alice\sidecar\local-api-server.mjs");
        assert_eq!(
            sanitize_path_for_node(raw),
            r"C:\Users\alice\sidecar\local-api-server.mjs".to_string()
        );
    }
}

#[cfg(test)]
mod linux_webkit_policy_tests {
    use super::{compute_linux_webkit_policy, LINUX_WEBKIT_SAFE_MODE_ENV, WEBKIT_DMABUF_ENV};

    #[test]
    fn wayland_default_applies_dmabuf_safeguard() {
        let policy = compute_linux_webkit_policy(
            Some("wayland".to_string()),
            Some("wayland-0".to_string()),
            Some(":0".to_string()),
            None,
            None,
        );
        assert!(policy.applied_dmabuf_disable);
        assert!(policy.safe_mode_enabled);
        assert_eq!(policy.session, "wayland".to_string());
    }

    #[test]
    fn wayland_safe_mode_disabled_skips_safeguard() {
        let policy = compute_linux_webkit_policy(
            Some("wayland".to_string()),
            Some("wayland-0".to_string()),
            Some(":0".to_string()),
            Some("0".to_string()),
            None,
        );
        assert!(!policy.applied_dmabuf_disable);
        assert!(!policy.safe_mode_enabled);
        assert!(policy.decision_reason.contains(LINUX_WEBKIT_SAFE_MODE_ENV));
    }

    #[test]
    fn wayland_preserves_existing_dmabuf_override() {
        let policy = compute_linux_webkit_policy(
            Some("wayland".to_string()),
            Some("wayland-0".to_string()),
            Some(":0".to_string()),
            None,
            Some("0".to_string()),
        );
        assert!(!policy.applied_dmabuf_disable);
        assert_eq!(policy.existing_dmabuf_value.as_deref(), Some("0"));
        assert!(policy.decision_reason.contains(WEBKIT_DMABUF_ENV));
    }

    #[test]
    fn x11_session_does_not_apply_wayland_safeguard() {
        let policy = compute_linux_webkit_policy(
            Some("x11".to_string()),
            None,
            Some(":0".to_string()),
            None,
            None,
        );
        assert_eq!(policy.session, "x11".to_string());
        assert!(!policy.applied_dmabuf_disable);
    }
}

fn local_api_paths(app: &AppHandle) -> (PathBuf, PathBuf) {
    let resource_dir = app
        .path()
        .resource_dir()
        .unwrap_or_else(|_| PathBuf::from("."));

    let sidecar_script = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("sidecar/local-api-server.mjs")
    } else {
        resource_dir.join("sidecar/local-api-server.mjs")
    };

    let api_dir_root = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."))
    } else {
        let direct_api = resource_dir.join("api");
        let lifted_root = resource_dir.join("_up_");
        let lifted_api = lifted_root.join("api");
        if direct_api.exists() {
            resource_dir
        } else if lifted_api.exists() {
            lifted_root
        } else {
            resource_dir
        }
    };

    (sidecar_script, api_dir_root)
}

fn resolve_node_binary(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(explicit) = env::var("LOCAL_API_NODE_BIN") {
        let explicit_path = PathBuf::from(explicit);
        if explicit_path.is_file() {
            return Some(explicit_path);
        }
        append_desktop_log(
            app,
            "WARN",
            &format!(
                "LOCAL_API_NODE_BIN is set but not a valid file: {}",
                explicit_path.display()
            ),
        );
    }

    if !cfg!(debug_assertions) {
        let node_name = if cfg!(windows) { "node.exe" } else { "node" };
        if let Ok(resource_dir) = app.path().resource_dir() {
            let bundled = resource_dir.join("sidecar").join("node").join(node_name);
            if bundled.is_file() {
                return Some(bundled);
            }
        }
    }

    let node_name = if cfg!(windows) { "node.exe" } else { "node" };
    if let Some(path_var) = env::var_os("PATH") {
        for dir in env::split_paths(&path_var) {
            let candidate = dir.join(node_name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    let common_locations = if cfg!(windows) {
        vec![
            PathBuf::from(r"C:\Program Files\nodejs\node.exe"),
            PathBuf::from(r"C:\Program Files (x86)\nodejs\node.exe"),
        ]
    } else {
        vec![
            PathBuf::from("/opt/homebrew/bin/node"),
            PathBuf::from("/usr/local/bin/node"),
            PathBuf::from("/usr/bin/node"),
            PathBuf::from("/opt/local/bin/node"),
        ]
    };

    common_locations.into_iter().find(|path| path.is_file())
}

fn start_local_api(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<LocalApiState>();
    let mut slot = state
        .child
        .lock()
        .map_err(|_| "Failed to lock local API state".to_string())?;
    if slot.is_some() {
        return Ok(());
    }

    let (script, resource_root) = local_api_paths(app);
    if !script.exists() {
        return Err(format!(
            "Local API sidecar script missing at {}",
            script.display()
        ));
    }
    let node_binary = resolve_node_binary(app).ok_or_else(|| {
        "Node.js executable not found. Install Node 18+ or set LOCAL_API_NODE_BIN".to_string()
    })?;

    let log_path = sidecar_log_path(app)?;
    let log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("Failed to open local API log {}: {e}", log_path.display()))?;
    let log_file_err = log_file
        .try_clone()
        .map_err(|e| format!("Failed to clone local API log handle: {e}"))?;

    append_desktop_log(
        app,
        "INFO",
        &format!(
            "starting local API sidecar script={} resource_root={} log={}",
            script.display(),
            resource_root.display(),
            log_path.display()
        ),
    );
    append_desktop_log(
        app,
        "INFO",
        &format!("resolved node binary={}", node_binary.display()),
    );

    // Generate a unique token for local API auth (prevents other local processes from accessing sidecar)
    let mut token_slot = state
        .token
        .lock()
        .map_err(|_| "Failed to lock token slot")?;
    if token_slot.is_none() {
        *token_slot = Some(generate_local_token());
    }
    let local_api_token = token_slot.clone().unwrap();
    drop(token_slot);

    let mut cmd = Command::new(&node_binary);
    // Windows only: hide the Node sidecar console window.
    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    let script_for_node = sanitize_path_for_node(&script);
    let resource_for_node = sanitize_path_for_node(&resource_root);
    append_desktop_log(
        app,
        "INFO",
        &format!("node args: script={script_for_node} resource_dir={resource_for_node}"),
    );
    cmd.arg(&script_for_node)
        .env("LOCAL_API_PORT", LOCAL_API_PORT)
        .env("LOCAL_API_RESOURCE_DIR", &resource_for_node)
        .env("LOCAL_API_MODE", "tauri-sidecar")
        .env("LOCAL_API_TOKEN", &local_api_token)
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(log_file_err));
    if let Some(parent) = script.parent() {
        cmd.current_dir(parent);
    }

    // Pass cached keychain secrets to sidecar as env vars (no keychain re-read)
    let mut secret_count = 0u32;
    let secrets_cache = app.state::<SecretsCache>();
    if let Ok(secrets) = secrets_cache.secrets.lock() {
        for (key, value) in secrets.iter() {
            cmd.env(key, value);
            secret_count += 1;
        }
    }
    append_desktop_log(
        app,
        "INFO",
        &format!("injected {secret_count} keychain secrets into sidecar env"),
    );

    // Inject local-first mode preference into sidecar
    let local_first = {
        let prefs = read_runtime_prefs(app);
        prefs.get("localFirst").and_then(|v| v.as_bool()).unwrap_or(false)
    };
    cmd.env("LOCAL_API_LOCAL_FIRST", if local_first { "true" } else { "false" });
    append_desktop_log(
        app,
        "INFO",
        &format!("local-first mode: {local_first}"),
    );

    // Inject self-URL for forensics worker (sidecar serves /internal/forensics endpoints)
    cmd.env("FORENSICS_WORKER_URL", format!("http://127.0.0.1:{LOCAL_API_PORT}"));
    // Reuse the session token as shared secret so callWorker() can authenticate
    cmd.env("FORENSICS_WORKER_SHARED_SECRET", &local_api_token);

    // Inject build-time secrets (CI) with runtime env fallback (dev)
    if let Some(url) = option_env!("CONVEX_URL") {
        cmd.env("CONVEX_URL", url);
    } else if let Ok(url) = std::env::var("CONVEX_URL") {
        cmd.env("CONVEX_URL", url);
    }

    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to launch local API: {e}"))?;
    append_desktop_log(
        app,
        "INFO",
        &format!("local API sidecar started pid={}", child.id()),
    );
    *slot = Some(child);
    Ok(())
}

#[cfg(unix)]
fn graceful_kill(child: &mut std::process::Child) {
    let pid = child.id() as libc::pid_t;
    unsafe { libc::kill(pid, libc::SIGTERM); }
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => { let _ = child.wait(); return; }
            Ok(None) if std::time::Instant::now() < deadline => {
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            _ => break,
        }
    }
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(not(unix))]
fn graceful_kill(child: &mut std::process::Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn stop_local_api(app: &AppHandle) {
    if let Ok(state) = app.try_state::<LocalApiState>().ok_or(()) {
        if let Ok(mut slot) = state.child.lock() {
            if let Some(mut child) = slot.take() {
                graceful_kill(&mut child);
                append_desktop_log(app, "INFO", "local API sidecar stopped");
            }
        }
    }
}

fn main() {
    let linux_webkit_policy = apply_linux_webkit_env_policy();
    if let Some(policy) = linux_webkit_policy.as_ref() {
        eprintln!("[tauri] {}", format_linux_webkit_policy(policy));
    }

    let app = tauri::Builder::default()
        .menu(build_app_menu)
        .on_menu_event(handle_menu_event)
        .manage(LocalApiState::default())
        .manage(SecretsCache::load_from_keychain())
        .invoke_handler(tauri::generate_handler![
            list_supported_secret_keys,
            get_secret,
            get_all_secrets,
            set_secret,
            delete_secret,
            get_local_api_token,
            get_desktop_runtime_info,
            read_cache_entry,
            write_cache_entry,
            open_logs_folder,
            open_sidecar_log_file,
            open_settings_window_command,
            close_settings_window,
            open_url,
            fetch_polymarket,
            get_local_first_mode,
            set_local_first_mode
        ])
        .setup(move |app| {
            let handle = app.handle();
            log_startup_stage(&handle, "setup.begin", "desktop runtime initialization");

            if let Some(policy) = linux_webkit_policy.as_ref() {
                append_desktop_log(&handle, "INFO", &format_linux_webkit_policy(policy));
            }

            log_startup_stage(&handle, "setup.start_local_api.begin", "");
            match start_local_api(&handle) {
                Ok(()) => {
                    log_startup_stage(&handle, "setup.start_local_api.success", "");
                }
                Err(err) => {
                    append_desktop_log(
                        &handle,
                        "ERROR",
                        &format!("local API sidecar failed to start: {err}"),
                    );
                    eprintln!("[tauri] local API sidecar failed to start: {err}");
                    log_startup_stage(&handle, "setup.start_local_api.failed", &err);
                }
            }
            log_startup_stage(&handle, "setup.complete", "desktop runtime setup finished");
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running world-monitor tauri application");

    append_desktop_log(
        &app.handle(),
        "INFO",
        "startup stage=builder.build.complete tauri build completed",
    );

    app.run(|app, event| {
        match &event {
            RunEvent::Ready => {
                log_startup_stage(app, "run.ready", "event loop started");
            }
            // macOS: hide window on close instead of quitting (standard behavior)
            #[cfg(target_os = "macos")]
            RunEvent::WindowEvent {
                label,
                event: WindowEvent::CloseRequested { api, .. },
                ..
            } if label == "main" => {
                api.prevent_close();
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
            // macOS: reshow window when dock icon is clicked
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            // Raise settings window when main window gains focus so it doesn't hide behind
            RunEvent::WindowEvent {
                label,
                event: WindowEvent::Focused(true),
                ..
            } if label == "main" => {
                if let Some(sw) = app.get_webview_window("settings") {
                    let _ = sw.show();
                    let _ = sw.set_focus();
                }
            }
            RunEvent::ExitRequested { .. } | RunEvent::Exit => {
                stop_local_api(app);
            }
            _ => {}
        }
    });
}
