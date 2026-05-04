use grammers_client::Client;
use std::sync::Arc;
use tokio::sync::Mutex;
use serde::{Serialize, Deserialize};
use grammers_session::types::PeerId;

#[derive(Clone)]
pub struct AppState {
    pub client: Arc<Mutex<Option<Client>>>,
    pub api_id: Arc<Mutex<Option<i32>>>,
    pub api_hash: Arc<Mutex<Option<String>>>,
    pub phone: Arc<Mutex<Option<String>>>,
    pub login_token: Arc<Mutex<Option<grammers_client::client::LoginToken>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            client: Arc::new(Mutex::new(None)),
            api_id: Arc::new(Mutex::new(None)),
            api_hash: Arc::new(Mutex::new(None)),
            phone: Arc::new(Mutex::new(None)),
            login_token: Arc::new(Mutex::new(None)),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ChatInfo {
    pub id: PeerId,
    pub title: String,
    pub chat_type: String,
    pub message_count: i32,
    pub avatar_base64: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DeletionStatus {
    pub chat_id: PeerId,
    pub deleted_count: usize,
    pub scanned_count: usize,
    pub remaining_count: usize,
    pub is_done: bool,
    pub error: Option<String>,
    pub flood_wait: Option<u32>,
}
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct UserInfo {
    pub name: String,
    pub avatar_base64: Option<String>,
}
