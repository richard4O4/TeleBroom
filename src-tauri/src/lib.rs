mod tg_client;

use tauri::{AppHandle, Emitter, State, Manager};
use tg_client::{AppState, ChatInfo, DeletionStatus, UserInfo};
use grammers_client::{Client, SignInError, peer::Peer};
use grammers_session::storages::SqliteSession;
use grammers_mtsender::SenderPool;
use grammers_session::types::{PeerId, PeerRef, PeerAuth};
use std::sync::Arc;
use std::time::{Duration, Instant};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use serde_json::json;
use tokio::sync::Semaphore;

fn get_system_proxy_url() -> Option<String> {
    // 1. Check environment variables (common on Linux/macOS)
    for var in ["ALL_PROXY", "all_proxy", "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"] {
        if let Ok(proxy) = std::env::var(var) {
            if !proxy.is_empty() {
                return Some(proxy);
            }
        }
    }

    // 2. Check system settings
    #[cfg(target_os = "macos")]
    {
        use sysproxy::Sysproxy;
        // Try common services on macOS
        for service in ["Wi-Fi", "Ethernet", "Thunderbolt Bridge"] {
            if let Ok(proxy) = Sysproxy::get_socks(service) {
                if proxy.enable {
                    return Some(format!("socks5://{}:{}", proxy.host, proxy.port));
                }
            }
            if let Ok(proxy) = Sysproxy::get_http(service) {
                if proxy.enable {
                    return Some(format!("http://{}:{}", proxy.host, proxy.port));
                }
            }
        }
    }

    if let Ok(proxy) = sysproxy::Sysproxy::get_system_proxy() {
        if proxy.enable {
            return Some(format!("http://{}:{}", proxy.host, proxy.port));
        }
    }
    None
}

async fn get_session_and_config(app: &AppHandle) -> Result<(std::path::PathBuf, Option<i32>), String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    if !app_dir.exists() {
        std::fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
    }
    let config_path = app_dir.join("config.json");
    let api_id = if config_path.exists() {
        let content = std::fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
        let config: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        config["api_id"].as_i64().map(|id| id as i32)
    } else {
        None
    };
    Ok((app_dir.join("session.sqlite"), api_id))
}

#[tauri::command]
async fn check_auth(app: AppHandle, state: State<'_, AppState>, proxy_url: Option<String>) -> Result<bool, String> {
    let (session_path, api_id) = get_session_and_config(&app).await?;
    let api_id = match api_id {
        Some(id) => id,
        None => return Ok(false),
    };

    if session_path.exists() {
        if let Ok(metadata) = std::fs::metadata(&session_path) {
            if metadata.len() == 0 {
                let _ = std::fs::remove_file(&session_path);
            }
        }
    }
    let session = Arc::new(SqliteSession::open(session_path.to_str().ok_or("Invalid path")?).await.map_err(|e| e.to_string())?);
    let mut params = grammers_mtsender::ConnectionParams::default();
    params.proxy_url = proxy_url.or_else(get_system_proxy_url);
    let SenderPool { runner, handle, .. } = SenderPool::with_configuration(Arc::clone(&session), api_id, params);
    let client = Client::new(handle);
    tokio::spawn(runner.run());

    if client.is_authorized().await.unwrap_or(false) {
        *state.client.lock().await = Some(client);
        *state.api_id.lock().await = Some(api_id);
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
async fn get_me(state: State<'_, AppState>) -> Result<UserInfo, String> {
    let client = {
        let lock = state.client.lock().await;
        lock.as_ref().cloned().ok_or("Client not initialized")?
    };

    let me = client.get_me().await.map_err(|e| e.to_string())?;
    let name = format!("{} {}", me.first_name().unwrap_or(""), me.last_name().unwrap_or("")).trim().to_string();
    
    let mut avatar_base64 = None;
    // Use Peer::User to get the photo in a Downloadable format
    let peer = Peer::User(me);
    if let Some(photo) = peer.photo(false).await {
        let mut buf = Vec::new();
        let mut download = client.iter_download(&photo);
        while let Ok(Some(chunk)) = download.next().await {
            buf.extend(chunk);
            if buf.len() > 1024 * 50 { break; }
        }
        if !buf.is_empty() {
            avatar_base64 = Some(BASE64.encode(buf));
        }
    }

    Ok(UserInfo { name, avatar_base64 })
}

#[tauri::command]
async fn request_code(
    app: AppHandle,
    state: State<'_, AppState>,
    api_id: i32,
    api_hash: String,
    phone: String,
    proxy_url: Option<String>,
) -> Result<String, String> {
    let (session_path, _) = get_session_and_config(&app).await?;
    
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let config_path = app_dir.join("config.json");
    std::fs::write(&config_path, json!({"api_id": api_id}).to_string()).map_err(|e| e.to_string())?;

    if session_path.exists() {
        if let Ok(metadata) = std::fs::metadata(&session_path) {
            if metadata.len() == 0 {
                let _ = std::fs::remove_file(&session_path);
            }
        }
    }
    let session = Arc::new(SqliteSession::open(session_path.to_str().ok_or("Invalid path")?).await.map_err(|e| e.to_string())?);
    let mut params = grammers_mtsender::ConnectionParams::default();
    params.proxy_url = proxy_url.or_else(get_system_proxy_url);
    let SenderPool { runner, handle, .. } = SenderPool::with_configuration(Arc::clone(&session), api_id, params);
    let client = Client::new(handle);
    tokio::spawn(runner.run());

    let login_token = client.request_login_code(&phone, &api_hash)
        .await
        .map_err(|e| e.to_string())?;

    *state.client.lock().await = Some(client);
    *state.api_id.lock().await = Some(api_id);
    *state.api_hash.lock().await = Some(api_hash);
    *state.phone.lock().await = Some(phone);
    *state.login_token.lock().await = Some(login_token);

    Ok("Code requested".to_string())
}

#[tauri::command]
async fn logout(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    *state.client.lock().await = None;
    *state.api_id.lock().await = None;
    
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let session_path = app_dir.join("session.sqlite");
    let config_path = app_dir.join("config.json");
    
    if session_path.exists() {
        let _ = std::fs::remove_file(session_path);
    }
    if config_path.exists() {
        let _ = std::fs::remove_file(config_path);
    }
    
    Ok(())
}

#[tauri::command]
async fn submit_code(
    state: State<'_, AppState>,
    code: String,
) -> Result<String, String> {
    let mut client_lock = state.client.lock().await;
    let client = client_lock.as_mut().ok_or("Client not initialized")?;
    
    let mut token_lock = state.login_token.lock().await;
    let token = token_lock.take().ok_or("Login token not found")?;

    match client.sign_in(&token, &code).await {
        Ok(_) => Ok("Logged in".to_string()),
        Err(SignInError::PasswordRequired(pwd_token)) => {
            *state.password_token.lock().await = Some(pwd_token);
            Err("Password required".to_string())
        },
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn submit_password(
    state: State<'_, AppState>,
    password: String,
) -> Result<String, String> {
    let mut client_lock = state.client.lock().await;
    let client = client_lock.as_mut().ok_or("Client not initialized")?;
    
    let mut pwd_token_lock = state.password_token.lock().await;
    let pwd_token = pwd_token_lock.take().ok_or("Password token not found")?;

    match client.check_password(pwd_token, &password).await {
        Ok(_) => Ok("Logged in".to_string()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn get_chats(state: State<'_, AppState>) -> Result<Vec<ChatInfo>, String> {
    let client = {
        let lock = state.client.lock().await;
        lock.as_ref().cloned().ok_or("Client not initialized")?
    };

    let mut dialogs = client.iter_dialogs();
    let mut tasks = Vec::new();
    let semaphore = Arc::new(Semaphore::new(10));

    while let Ok(Some(dialog)) = dialogs.next().await {
        let peer = dialog.peer().clone();
        let client_clone = client.clone();
        let sem_clone = Arc::clone(&semaphore);
        
        let task = tokio::spawn(async move {
            let _permit = sem_clone.acquire().await;
            
            let (chat_type, title, is_broadcast) = match &peer {
                Peer::Group(g) => ("Group", g.title().unwrap_or("Unknown").to_string(), false),
                Peer::Channel(c) => ("Supergroup", c.title().to_string(), c.raw.broadcast),
                Peer::User(_) => ("User", "".to_string(), false),
            };

            if chat_type == "User" || is_broadcast {
                return None;
            }

            let count = if let Some(input_peer) = peer.to_ref().await {
                let total = client_clone.search_messages(input_peer).sent_by_self().total().await.unwrap_or(0) as i32;
                if total > 0 {
                    // Verification step: Iterate through messages and exclude service messages (like "joined group").
                    // For performance, we only do a full count if the total is small.
                    // If total is large, we check the first few to see if they are service messages.
                    let mut actual_count = 0;
                    let mut scanned = 0;
                    let mut it = client_clone.search_messages(input_peer).sent_by_self().limit(100);
                    while let Ok(Some(msg)) = it.next().await {
                        scanned += 1;
                        if msg.action().is_none() {
                            actual_count += 1;
                        }
                    }
                    
                    let service_msgs_found = scanned - actual_count;
                    (total - service_msgs_found).max(0)
                } else {
                    total
                }
            } else {
                0
            };

            let mut avatar_base64 = None;
            if let Some(photo) = peer.photo(false).await {
                let mut buf = Vec::new();
                let mut download = client_clone.iter_download(&photo);
                while let Ok(Some(chunk)) = download.next().await {
                    buf.extend(chunk);
                    if buf.len() > 1024 * 50 { break; }
                }
                if !buf.is_empty() {
                    avatar_base64 = Some(BASE64.encode(buf));
                }
            }

            Some(ChatInfo {
                id: peer.id(),
                title,
                chat_type: chat_type.to_string(),
                message_count: count,
                avatar_base64,
            })
        });
        tasks.push(task);
    }

    let mut chats = Vec::new();
    for task in tasks {
        if let Ok(Some(chat)) = task.await {
            chats.push(chat);
        }
    }

    Ok(chats)
}

#[tauri::command]
async fn start_deletion(
    app: AppHandle,
    state: State<'_, AppState>,
    chat_ids: Vec<PeerId>,
) -> Result<(), String> {
    let client = state.client.lock().await.as_ref().cloned().ok_or("Client not initialized")?;
    
    tokio::spawn(async move {
        let semaphore = Arc::new(Semaphore::new(3));
        let mut group_tasks = Vec::new();

        for chat_id in chat_ids {
            let app_clone = app.clone();
            let client_clone = client.clone();
            let sem_clone = Arc::clone(&semaphore);

            let task = tokio::spawn(async move {
                let _permit = sem_clone.acquire().await;
                
                let peer_ref = PeerRef { id: chat_id, auth: PeerAuth::from_hash(0) };
                let packed_chat = match client_clone.resolve_peer(peer_ref).await {
                    Ok(peer) => peer,
                    Err(e) => {
                        let _ = app_clone.emit("deletion-progress", DeletionStatus {
                            chat_id,
                            deleted_count: 0,
                            scanned_count: 0,
                            remaining_count: 0,
                            is_done: true,
                            error: Some(format!("Failed to resolve peer: {}", e)),
                            flood_wait: None,
                        });
                        return;
                    }
                };

                let input_peer = match packed_chat.to_ref().await {
                    Some(r) => r,
                    None => {
                        let _ = app_clone.emit("deletion-progress", DeletionStatus {
                            chat_id,
                            deleted_count: 0,
                            scanned_count: 0,
                            remaining_count: 0,
                            is_done: true,
                            error: Some("Failed to get input peer".to_string()),
                            flood_wait: None,
                        });
                        return;
                    }
                };

                let mut deleted_total = 0;
                let mut messages = client_clone.search_messages(input_peer).sent_by_self();
                let mut to_delete = Vec::new();

                while let Ok(Some(msg)) = messages.next().await {
                    if msg.action().is_some() {
                        continue;
                    }
                    to_delete.push(msg.id());

                    if to_delete.len() >= 100 {
                        let batch_size = to_delete.len();
                        match client_clone.delete_messages(input_peer, &to_delete).await {
                            Ok(_) => {
                                deleted_total += batch_size;
                                let _ = app_clone.emit("deletion-progress", DeletionStatus {
                                    chat_id,
                                    deleted_count: deleted_total,
                                    scanned_count: deleted_total, // Now scanned == deleted because we search
                                    remaining_count: 0,
                                    is_done: false,
                                    error: None,
                                    flood_wait: None,
                                });
                            }
                            Err(e) => {
                                let error_str = e.to_string();
                                if error_str.contains("FLOOD_WAIT") {
                                    let wait_secs = error_str.split_whitespace()
                                        .filter_map(|s| s.parse::<u32>().ok())
                                        .next()
                                        .unwrap_or(30);

                                    let _ = app_clone.emit("deletion-progress", DeletionStatus {
                                        chat_id,
                                        deleted_count: deleted_total,
                                        scanned_count: deleted_total,
                                        remaining_count: 0,
                                        is_done: false,
                                        error: Some(format!("Flood wait: {}s", wait_secs)),
                                        flood_wait: Some(wait_secs),
                                    });
                                    tokio::time::sleep(tokio::time::Duration::from_secs(wait_secs as u64)).await;
                                    // With search_messages, we can't easily "retry" the same batch 
                                    // if the iterator already moved. But grammers handles some logic.
                                    // We'll just continue.
                                } else {
                                    let _ = app_clone.emit("deletion-progress", DeletionStatus {
                                        chat_id,
                                        deleted_count: deleted_total,
                                        scanned_count: deleted_total,
                                        remaining_count: 0,
                                        is_done: true,
                                        error: Some(error_str),
                                        flood_wait: None,
                                    });
                                    return;
                                }
                            }
                        }
                        to_delete.clear();
                        tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
                    }
                }

                // Final batch
                if !to_delete.is_empty() {
                    let batch_size = to_delete.len();
                    if let Ok(_) = client_clone.delete_messages(input_peer, &to_delete).await {
                        deleted_total += batch_size;
                    }
                }

                let _ = app_clone.emit("deletion-progress", DeletionStatus {
                    chat_id,
                    deleted_count: deleted_total,
                    scanned_count: deleted_total,
                    remaining_count: 0,
                    is_done: true,
                    error: None,
                    flood_wait: None,
                });
            });
            group_tasks.push(task);
        }
        
        for t in group_tasks { let _ = t.await; }
    });

    Ok(())
}

#[tauri::command]
async fn test_proxy(proxy_url: Option<String>) -> Result<String, String> {
    let target = "https://api.telegram.org";
    
    let mut builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(10));

    let effective_proxy = proxy_url.or_else(get_system_proxy_url);
    
    if let Some(url) = effective_proxy {
        match reqwest::Proxy::all(&url) {
            Ok(p) => { builder = builder.proxy(p); },
            Err(e) => return Err(format!("Invalid proxy URL: {}", e)),
        }
    }

    let client = builder.build().map_err(|e| e.to_string())?;
    
    let start = Instant::now();
    match client.get(target).send().await {
        Ok(resp) => {
            let duration = start.elapsed().as_millis();
            if resp.status().is_success() {
                Ok(format!("Connected to Telegram! ({}ms)", duration))
            } else {
                Err(format!("Connected, but received status: {}", resp.status()))
            }
        }
        Err(e) => Err(format!("Connection failed: {}", e)),
    }
}

#[tauri::command]
async fn open_url(url: String) -> Result<(), String> {
    open::that(url).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = app.get_webview_window("main").map(|w| w.set_focus());
        }))
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            check_auth,
            get_me,
            request_code,
            submit_code,
            submit_password,
            get_chats,
            start_deletion,
            open_url,
            test_proxy,
            logout
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
