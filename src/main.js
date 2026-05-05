const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

// State
let selectedChatIds = new Set();
let allChats = [];
let filteredChats = [];
let progressData = {}; // Map of chat_id -> { deleted_count, scanned_count, is_done, error, flood_wait, startTime, totalMsgs, title }
let progressElements = new Map(); // chat_id -> DOM element
let manualProxy = localStorage.getItem('manual_proxy') || null;

// DOM Elements
const screens = {
  login: document.getElementById('screen-login'),
  otp: document.getElementById('screen-otp'),
  '2fa': document.getElementById('screen-2fa'),
  main: document.getElementById('screen-main'),
  progress: document.getElementById('screen-progress')
};

function showScreen(screenId) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[screenId].classList.add('active');
}

// Theme Handling
const themeToggle = document.getElementById('btn-theme-toggle');
const currentTheme = localStorage.getItem('theme') || 'light';
document.body.setAttribute('data-theme', currentTheme);

themeToggle.addEventListener('click', () => {
  const isDark = document.body.getAttribute('data-theme') === 'dark';
  const newTheme = isDark ? 'light' : 'dark';
  document.body.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
});

// Check auth on startup
window.addEventListener('DOMContentLoaded', async () => {
  // Set a safety timer to ensure we don't stay "Checking" forever
  const safetyTimer = setTimeout(() => {
    const chip = document.getElementById('auth-status-chip');
    if (chip && chip.classList.contains('checking')) {
       updateStatus('disconnected');
    }
  }, 10000); // 10s timeout for auth check

  try {
    const isAuth = await invoke('check_auth', { proxyUrl: manualProxy });
    clearTimeout(safetyTimer);
    if (isAuth) {
      await updateMe();
      showScreen('main');
      await loadChats();
    } else {
      updateStatus('disconnected');
    }
  } catch (err) {
    console.error("Startup auth check failed:", err);
    updateStatus('disconnected');
  }
});

function updateStatus(state) {
  const chip = document.getElementById('auth-status-chip');
  const text = document.getElementById('auth-status-text');
  const userProfile = document.getElementById('user-profile');
  
  if (state === 'checking') {
    chip.style.display = 'flex';
    chip.className = 'status-chip checking';
    text.textContent = 'Checking session...';
    userProfile.style.display = 'none';
  } else if (state === 'disconnected') {
    chip.style.display = 'flex';
    chip.className = 'status-chip logout';
    text.textContent = 'Disconnected';
    userProfile.style.display = 'none';
  } else if (state === 'connected') {
    chip.style.display = 'none';
    userProfile.style.display = 'flex';
  }
}

async function updateMe() {
  try {
    const user = await invoke('get_me');
    const nameEl = document.getElementById('user-name');
    const avatarImg = document.getElementById('user-avatar');
    const placeholder = document.getElementById('user-avatar-placeholder');

    updateStatus('connected');
    nameEl.textContent = user.name;
    if (user.avatar_base64) {
      avatarImg.src = `data:image/jpeg;base64,${user.avatar_base64}`;
      avatarImg.style.display = 'block';
      placeholder.style.display = 'none';
    } else {
      avatarImg.style.display = 'none';
      placeholder.style.display = 'flex';
      placeholder.textContent = user.name.charAt(0);
    }
  } catch (err) {
    console.error("Failed to fetch user info:", err);
    updateStatus('disconnected');
  }
}

// User Menu Toggle
const userChip = document.getElementById('user-profile');
const userMenu = document.getElementById('user-menu');

userChip.addEventListener('click', (e) => {
  e.stopPropagation();
  userMenu.classList.toggle('active');
});

document.addEventListener('click', () => {
  userMenu.classList.remove('active');
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  const confirmed = await showModal("Confirm Logout", "Are you sure you want to log out?");
  if (!confirmed) return;
  
  try {
    await invoke('logout');
    updateStatus('disconnected');
    showScreen('login');
  } catch (err) {
    alert("Logout failed: " + err);
  }
});

// --- Login Flow ---
document.getElementById('btn-request-code').addEventListener('click', async () => {
  const apiId = parseInt(document.getElementById('api-id').value);
  const apiHash = document.getElementById('api-hash').value;
  const phone = document.getElementById('phone').value;
  const errorEl = document.getElementById('login-error');
  const btn = document.getElementById('btn-request-code');

  if (!apiId || !apiHash || !phone) {
    errorEl.textContent = "Please fill in all fields";
    errorEl.style.display = 'block';
    return;
  }

  try {
    btn.disabled = true;
    btn.innerHTML = `<div class="spinner" style="width:20px; height:20px; border-width:2px;"></div>`;
    errorEl.style.display = 'none';
    await invoke('request_code', { apiId, apiHash, phone, proxyUrl: manualProxy });
    showScreen('otp');
  } catch (err) {
    errorEl.textContent = err;
    errorEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = "Request Verification Code";
  }
});

document.getElementById('link-get-api').addEventListener('click', (e) => {
  e.preventDefault();
  invoke('open_url', { url: 'https://github.com/richard4O4/TeleBroom#-telegram-api-setup' });
});

document.getElementById('btn-submit-otp').addEventListener('click', async () => {
  const code = document.getElementById('otp-code').value;
  const errorEl = document.getElementById('otp-error');
  const btn = document.getElementById('btn-submit-otp');

  try {
    btn.disabled = true;
    btn.innerHTML = `<div class="spinner" style="width:20px; height:20px; border-width:2px;"></div>`;
    errorEl.style.display = 'none';
    await invoke('submit_code', { code });
    await updateMe();
    showScreen('main');
    await loadChats();
  } catch (err) {
    if (err === "Password required") {
      showScreen('2fa');
    } else {
      errorEl.textContent = err;
      errorEl.style.display = 'block';
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "Login";
  }
});

document.getElementById('btn-submit-2fa').addEventListener('click', async () => {
  const password = document.getElementById('2fa-password').value;
  const errorEl = document.getElementById('2fa-error');
  const btn = document.getElementById('btn-submit-2fa');

  if (!password) {
    errorEl.textContent = "Please enter your password";
    errorEl.style.display = 'block';
    return;
  }

  try {
    btn.disabled = true;
    btn.innerHTML = `<div class="spinner" style="width:20px; height:20px; border-width:2px;"></div>`;
    errorEl.style.display = 'none';
    await invoke('submit_password', { password });
    await updateMe();
    showScreen('main');
    await loadChats();
  } catch (err) {
    errorEl.textContent = err;
    errorEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = "Verify Password";
  }
});

document.getElementById('btn-back-to-otp').addEventListener('click', () => showScreen('otp'));

document.getElementById('btn-back-to-login').addEventListener('click', () => showScreen('login'));

// --- Chat Selection ---
async function loadChats() {
  const chatListEl = document.getElementById('chat-list');
  const selectAllBtn = document.getElementById('btn-nuclear');
  const refreshBtn = document.getElementById('btn-refresh');

  // Clear previous state immediately
  selectedChatIds.clear();
  updateStartBtn();

  selectAllBtn.disabled = true;
  selectAllBtn.style.opacity = '0.5';
  refreshBtn.disabled = true;

  chatListEl.innerHTML = `
    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px;">
      <div class="spinner"></div>
      <div style="color: var(--m3-sys-light-on-surface-variant); margin-top: 16px;">Fetching chats...</div>
    </div>
  `;
  
  try {
    allChats = await invoke('get_chats');
    allChats.sort((a, b) => b.message_count - a.message_count);
    filteredChats = [...allChats];
    renderChats();
  } catch (err) {
    chatListEl.innerHTML = `<div style="color:var(--m3-sys-light-error); padding:20px; text-align:center">${err}</div>`;
  } finally {
    selectAllBtn.disabled = false;
    selectAllBtn.style.opacity = '1';
    refreshBtn.disabled = false;
  }
}

// Search Filtering
document.getElementById('group-search').addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase();
  filteredChats = allChats.filter(chat => chat.title.toLowerCase().includes(query));
  renderChats();
});

function renderChats() {
  const chatListEl = document.getElementById('chat-list');
  chatListEl.innerHTML = '';

  if (filteredChats.length === 0) {
    chatListEl.innerHTML = '<div style="color: var(--m3-sys-light-on-surface-variant); text-align: center; padding: 40px;">No groups found.</div>';
    return;
  }

  filteredChats.forEach(chat => {
    const isZero = chat.message_count === 0;
    const item = document.createElement('div');
    item.className = `chat-item ${selectedChatIds.has(chat.id) ? 'selected' : ''} ${isZero ? 'dimmed' : ''}`;
    
    if (isZero) {
        item.style.pointerEvents = 'none';
        item.style.opacity = '0.6';
    }

    const avatarHtml = chat.avatar_base64 
      ? `<img src="data:image/jpeg;base64,${chat.avatar_base64}" class="chat-avatar" />`
      : `<div class="chat-avatar-placeholder">${chat.title.charAt(0)}</div>`;

    item.innerHTML = `
      <div style="display: flex; align-items: center; flex: 1; min-width: 0;">
        ${avatarHtml}
        <div class="chat-content">
          <div class="chat-title">${chat.title}</div>
          <div class="chat-meta">${chat.chat_type}</div>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
        <div class="m3-badge ${isZero ? 'zero' : ''}">${isZero ? 'Clean' : chat.message_count + ' msgs'}</div>
        <input type="checkbox" class="chat-checkbox" value="${chat.id}" 
               ${selectedChatIds.has(chat.id) ? 'checked' : ''} 
               ${isZero ? 'disabled' : ''} />
      </div>
    `;
    
    if (!isZero) {
      item.addEventListener('click', (e) => {
        if (e.target.tagName !== 'INPUT') {
          const checkbox = item.querySelector('input');
          checkbox.checked = !checkbox.checked;
        }
        
        if (item.querySelector('input').checked) {
          selectedChatIds.add(chat.id);
          item.classList.add('selected');
        } else {
          selectedChatIds.delete(chat.id);
          item.classList.remove('selected');
        }
        updateStartBtn();
      });
    }
    
    chatListEl.appendChild(item);
  });
  updateStartBtn();
}

function updateStartBtn() {
  const btn = document.getElementById('btn-start-delete');
  const footer = document.getElementById('main-actions');
  const hasSelection = selectedChatIds.size > 0;
  
  footer.style.display = hasSelection ? 'block' : 'none';
  if (hasSelection) {
    btn.textContent = `Delete Messages in ${selectedChatIds.size} Chat(s)`;
  }
}

document.getElementById('btn-refresh').addEventListener('click', loadChats);

// Proxy Modal Logic
const proxyBtn = document.getElementById('btn-proxy-settings');
const proxyModal = document.getElementById('modal-proxy');
const proxyInput = document.getElementById('proxy-url-input');
const proxySaveBtn = document.getElementById('btn-proxy-save');
const proxyCloseBtn = document.getElementById('btn-proxy-close');
const proxyTestBtn = document.getElementById('btn-proxy-test');
const proxyTestResult = document.getElementById('proxy-test-result');

proxyBtn.addEventListener('click', () => {
  proxyInput.value = manualProxy || '';
  proxyTestResult.textContent = '';
  proxyModal.style.display = 'flex';
});

proxyTestBtn.addEventListener('click', async () => {
  const testUrl = proxyInput.value.trim() || null;
  proxyTestResult.textContent = "Testing...";
  proxyTestResult.style.color = "var(--m3-sys-light-on-surface-variant)";
  proxyTestBtn.disabled = true;

  try {
    const result = await invoke('test_proxy', { proxyUrl: testUrl });
    proxyTestResult.textContent = result;
    proxyTestResult.style.color = "#4CAF50"; // Green
  } catch (err) {
    proxyTestResult.textContent = err;
    proxyTestResult.style.color = "var(--m3-sys-light-error)";
  } finally {
    proxyTestBtn.disabled = false;
  }
});

proxyCloseBtn.addEventListener('click', () => {
  proxyModal.style.display = 'none';
});

proxySaveBtn.addEventListener('click', async () => {
  const newProxy = proxyInput.value.trim() || null;
  manualProxy = newProxy;
  if (newProxy) {
    localStorage.setItem('manual_proxy', newProxy);
  } else {
    localStorage.removeItem('manual_proxy');
  }
  proxyModal.style.display = 'none';
  
  // Re-check auth or reload if needed to apply proxy
  const currentScreen = Object.keys(screens).find(k => screens[k].classList.contains('active'));
  if (currentScreen === 'login') {
      // Just re-initialize auth check
      try {
          await invoke('check_auth', { proxyUrl: manualProxy });
      } catch(e) {}
  }
});

// Select All
document.getElementById('btn-nuclear').addEventListener('click', () => {
  const cleanableChats = filteredChats.filter(c => c.message_count > 0);
  if (cleanableChats.length === 0) return;

  const allCleanableSelected = cleanableChats.every(c => selectedChatIds.has(c.id));
  if (allCleanableSelected) {
    cleanableChats.forEach(c => selectedChatIds.delete(c.id));
    document.getElementById('btn-nuclear').textContent = "Select All";
  } else {
    cleanableChats.forEach(c => selectedChatIds.add(c.id));
    document.getElementById('btn-nuclear').textContent = "Deselect All";
  }
  renderChats();
});

// --- Modal ---
const modal = document.getElementById('modal-confirm');
let modalResolve = null;

function showModal(title, text) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-text').textContent = text;
  modal.style.display = 'flex';
  return new Promise(resolve => {
    modalResolve = resolve;
  });
}

document.getElementById('btn-confirm-yes').addEventListener('click', () => {
  modal.style.display = 'none';
  modalResolve(true);
});

document.getElementById('btn-confirm-no').addEventListener('click', () => {
  modal.style.display = 'none';
  modalResolve(false);
});

// --- Deletion Flow ---
document.getElementById('btn-start-delete').addEventListener('click', async () => {
  const confirmed = await showModal("Confirm Deletion", `Delete all your messages in ${selectedChatIds.size} chat(s)?`);
  if (!confirmed) return;

  const chatIds = Array.from(selectedChatIds);
  progressData = {};
  progressElements.clear();
  document.getElementById('progress-list').innerHTML = '';
  document.getElementById('btn-stop').textContent = "Cancel";
  
  chatIds.forEach(id => {
    const chat = allChats.find(c => c.id === id);
    progressData[id] = {
      deleted_count: 0,
      scanned_count: 0,
      is_done: false,
      error: null,
      flood_wait: null,
      startTime: Date.now(),
      totalMsgs: chat ? chat.message_count : 0,
      title: chat ? chat.title : id
    };
  });

  showScreen('progress');
  renderAllProgress();

  try {
    await invoke('start_deletion', { chatIds });
  } catch (err) {
    alert("Error starting deletion: " + err);
  }
});

function updateProgressItem(id) {
  const data = progressData[id];
  let el = progressElements.get(id);
  
  if (!el) {
    el = document.createElement('div');
    el.className = 'progress-container';
    el.id = `item-${id}`;
    progressElements.set(id, el);
    el.innerHTML = `
      <div class="progress-info">
        <span class="progress-title"></span>
        <span class="progress-meta"></span>
      </div>
      <div class="m3-linear-progress">
        <div class="m3-linear-progress-fill"></div>
      </div>
      <div class="status-label" style="font-size: 0.75rem; font-weight: 500;"></div>
      <div class="flood-area"></div>
    `;
    document.getElementById('progress-list').appendChild(el);
  }

  if (data.deleted_count > data.totalMsgs) data.totalMsgs = data.deleted_count;
  const percent = data.totalMsgs > 0 ? Math.min(100, (data.deleted_count / data.totalMsgs) * 100) : (data.is_done ? 100 : 0);
  
  const titleEl = el.querySelector('.progress-title');
  const metaEl = el.querySelector('.progress-meta');
  const barEl = el.querySelector('.m3-linear-progress-fill');
  const statusEl = el.querySelector('.status-label');
  const floodEl = el.querySelector('.flood-area');

  titleEl.textContent = data.title;
  metaEl.textContent = `${data.deleted_count} / ${data.totalMsgs}`;
  barEl.style.width = `${percent}%`;

  let statusText = "Cleaning...";
  let statusColor = "var(--m3-sys-light-primary)";
  
  if (data.error) {
    statusText = `Error: ${data.error}`;
    statusColor = "var(--m3-sys-light-error)";
  } else if (data.is_done) {
    statusText = "Finished";
    statusColor = "var(--m3-sys-light-on-surface-variant)";
  } else if (data.flood_wait) {
    statusText = "Paused (Rate Limit)";
    statusColor = "var(--m3-sys-light-tertiary)";
  }

  statusEl.textContent = statusText;
  statusEl.style.color = statusColor;
  barEl.style.backgroundColor = statusColor;

  if (data.flood_wait) {
    floodEl.innerHTML = `<div class="flood-wait-badge">Waiting ${data.flood_wait}s...</div>`;
  } else {
    floodEl.innerHTML = '';
  }
}

function renderAllProgress() {
  const overallBar = document.getElementById('overall-bar');
  const overallPercent = document.getElementById('overall-percent');
  const totalEtaEl = document.getElementById('total-eta');
  const progressListEl = document.getElementById('progress-list');
  const cancelBtn = document.getElementById('btn-stop');

  let totalDeleted = 0;
  let totalToProcess = 0;
  let activeRates = [];
  let allDone = true;

  Object.values(progressData).forEach(p => {
    totalDeleted += p.deleted_count;
    totalToProcess += p.totalMsgs;
    if (!p.is_done && !p.error) {
      allDone = false;
      if (p.deleted_count > 0) {
        const elapsed = (Date.now() - p.startTime) / 1000;
        activeRates.push(p.deleted_count / elapsed);
      }
    }
  });

  const globalPercent = totalToProcess > 0 ? Math.round((totalDeleted / totalToProcess) * 100) : 0;
  overallBar.style.width = `${globalPercent}%`;
  overallPercent.textContent = `${globalPercent}%`;

  if (allDone) {
    totalEtaEl.textContent = "Finished";
    cancelBtn.textContent = "Done";
  } else if (activeRates.length > 0) {
    const avgRate = activeRates.reduce((a, b) => a + b, 0) / activeRates.length;
    const remaining = totalToProcess - totalDeleted;
    const totalEta = Math.round(remaining / avgRate);
    totalEtaEl.textContent = `ETA: ${totalEta}s`;
  } else {
    totalEtaEl.textContent = "Cleaning...";
  }

  Object.keys(progressData).forEach(id => updateProgressItem(id));

  const sortedIds = Object.keys(progressData).sort((a, b) => {
    const pA = progressData[a];
    const pB = progressData[b];
    const score = (p) => {
      if (p.error) return 100;
      if (p.is_done) return 90;
      if (p.flood_wait) return 20;
      return 10;
    };
    return score(pA) - score(pB);
  });

  sortedIds.forEach(id => {
    const el = progressElements.get(id);
    if (el) progressListEl.appendChild(el);
  });
}

listen('deletion-progress', (event) => {
  const { chat_id, deleted_count, scanned_count, is_done, error, flood_wait } = event.payload;
  if (progressData[chat_id]) {
    progressData[chat_id].deleted_count = deleted_count;
    progressData[chat_id].scanned_count = scanned_count;
    progressData[chat_id].is_done = is_done;
    progressData[chat_id].error = error;
    progressData[chat_id].flood_wait = flood_wait;
    renderAllProgress();
  }
});

document.getElementById('btn-stop').addEventListener('click', async () => {
  const btn = document.getElementById('btn-stop');
  if (btn.textContent === "Done") {
    selectedChatIds.clear();
    document.getElementById('group-search').value = '';
    showScreen('main');
    await loadChats();
  } else {
    showScreen('main');
  }
});
