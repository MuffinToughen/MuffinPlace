const firebaseConfig = {
  apiKey: "AIzaSyBQJ85vle3bvFX9VXuEvUmCKpyhX2MNmfo",
  authDomain: "teamchatapp-5877c.firebaseapp.com",
  projectId: "teamchatapp-5877c",
  storageBucket: "teamchatapp-5877c.firebasestorage.app",
  messagingSenderId: "999662431586",
  appId: "1:999662431586:web:69ac0aaecd7f2a0c1d103b"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const db = firebase.firestore();
const auth = firebase.auth();

let currentUserData = null;
let currentRoom = 'general';
let unsubscribeListener = null;
let unsubscribeAnnouncements = null;
let typingTimeout = null;

// Dynamic Progress Bar Handler
function showLoading(show = true) {
  let topBar = document.getElementById('top-progress-bar');
  if (!topBar) {
    topBar = document.createElement('div');
    topBar.id = 'top-progress-bar';
    topBar.style.cssText = 'position:fixed;top:0;left:0;height:4px;width:0%;background:linear-gradient(90deg, #a855f7, #ec4899);z-index:99999;transition:width 0.3s ease;';
    document.body.appendChild(topBar);
  }

  const loader = document.getElementById('loading-screen');
  if (loader) loader.style.display = show ? 'flex' : 'none';

  if (show) {
    topBar.style.width = '40%';
    setTimeout(() => { if (topBar.style.width === '40%') topBar.style.width = '80%'; }, 200);
  } else {
    topBar.style.width = '100%';
    setTimeout(() => { topBar.style.width = '0%'; }, 300);
  }
}

// Generate unique username color palette
function getUserColor(name) {
  if (!name) return '#ffffff';
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 80%, 70%)`;
}

// Fullscreen Image Lightbox
function setupImageLightboxUI() {
  if (document.getElementById('image-lightbox-modal')) return;
  const modal = document.createElement('div');
  modal.id = 'image-lightbox-modal';
  modal.style.cssText = 'display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);z-index:100000;align-items:center;justify-content:center;cursor:pointer;';
  modal.onclick = () => modal.style.display = 'none';
  modal.innerHTML = `<img id="lightbox-img" style="max-width:90%;max-height:90%;border-radius:8px;box-shadow:0 0 20px rgba(0,0,0,0.8);" />`;
  document.body.appendChild(modal);
}

function openLightbox(src) {
  const modal = document.getElementById('image-lightbox-modal');
  const img = document.getElementById('lightbox-img');
  if (modal && img) {
    img.src = src;
    modal.style.display = 'flex';
  }
}

// Announcement Floating Ring Setup
function setupAnnouncementUI() {
  if (document.getElementById('announcement-ring-btn')) return;

  const btn = document.createElement('button');
  btn.id = 'announcement-ring-btn';
  btn.innerHTML = '<i class="fa-solid fa-bell"></i>';
  btn.onclick = openAnnouncementsModal;
  document.body.appendChild(btn);

  const modal = document.createElement('div');
  modal.id = 'announcement-modal';
  modal.style.cssText = 'display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:10000;align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div style="background:#181820;color:#fff;padding:20px;border-radius:8px;width:90%;max-width:500px;max-height:80vh;display:flex;flex-direction:column;gap:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <h3 style="margin:0;color:#a855f7;"><i class="fa-solid fa-bullhorn"></i> Announcements</h3>
        <button onclick="closeAnnouncementsModal()" style="background:none;border:none;color:#fff;cursor:pointer;font-size:18px;">✕</button>
      </div>
      <div id="announcement-input-container" style="display:none;flex-direction:column;gap:8px;">
        <textarea id="announcement-text" placeholder="Write announcement..." style="width:100%;height:60px;background:#232330;border:1px solid #323245;color:#fff;padding:8px;border-radius:6px;resize:none;"></textarea>
        <button onclick="postAnnouncement()" style="background:linear-gradient(135deg, #a855f7, #ec4899);color:#fff;border:none;padding:8px;border-radius:6px;cursor:pointer;font-weight:bold;">Post Announcement</button>
      </div>
      <div id="announcement-list" style="overflow-y:auto;max-height:50vh;display:flex;flex-direction:column;gap:10px;margin-top:10px;"></div>
    </div>
  `;
  document.body.appendChild(modal);
}

function setupTypingUI() {
  const container = document.getElementById('message-container');
  if (container && !document.getElementById('typing-indicator-bar')) {
    const typingBar = document.createElement('div');
    typingBar.id = 'typing-indicator-bar';
    typingBar.style.cssText = 'font-size:12px;opacity:0.75;padding:4px 16px;font-style:italic;color:#a855f7;min-height:18px;';
    container.parentNode.insertBefore(typingBar, container.nextSibling);
  }
}

function setupAuditLogRoomUI() {
  const isOwner = currentUserData && currentUserData.name === 'muffintoughen';
  let navBtn = document.getElementById('audit-log-nav-btn');

  if (isOwner) {
    if (!navBtn) {
      const sidebar = document.querySelector('.sidebar');
      if (sidebar) {
        navBtn = document.createElement('button');
        navBtn.id = 'audit-log-nav-btn';
        navBtn.className = 'nav-btn';
        navBtn.innerHTML = '<i class="fa-solid fa-shield-cat"></i> Audit Logs';
        navBtn.onclick = () => switchRoom('audit-logs');
        sidebar.appendChild(navBtn);
      }
    }
  } else if (navBtn) {
    navBtn.remove();
  }
}

// Authentication Listener
auth.onAuthStateChanged(async (user) => {
  showLoading(true);
  setupAnnouncementUI();
  setupImageLightboxUI();

  const authScreen = document.getElementById('auth-screen');
  const appScreen = document.getElementById('app-screen');
  const roleBtn = document.getElementById('role-btn');

  if (user) {
    try {
      const userDoc = await db.collection('users').doc(user.uid).get();
      const username = user.email ? user.email.split('@')[0] : 'User';
      
      if (userDoc.exists) {
        currentUserData = userDoc.data();
      } else {
        const defaultRoles = (username === 'muffintoughen') ? ['OWNER', 'BOSS'] : ['Member'];
        currentUserData = { name: username, email: user.email, roles: defaultRoles };
        await db.collection('users').doc(user.uid).set(currentUserData);
      }

      if (roleBtn) {
        roleBtn.style.display = (currentUserData.name === 'muffintoughen') ? 'flex' : 'none';
      }

    } catch (e) {
      console.error("Firestore User Error:", e);
      currentUserData = { name: user.email ? user.email.split('@')[0] : 'User', roles: ['Member'] };
    }
    
    setupAuditLogRoomUI();
    setupTypingUI();
    if (authScreen) authScreen.style.display = 'none';
    if (appScreen) appScreen.style.display = 'flex';
    loadRoomMessages('general');
    listenTypingStatus();
    attachTypingEvents();
  } else {
    currentUserData = null;
    if (authScreen) authScreen.style.display = 'flex';
    if (appScreen) appScreen.style.display = 'none';
  }
  showLoading(false);
});

async function handleAuth() {
  const emailInput = document.getElementById('email-input');
  const passwordInput = document.getElementById('password-input');
  if (!emailInput || !passwordInput) return alert("UI elements missing.");

  const email = emailInput.value.trim();
  const password = passwordInput.value;
  if (!email || !password) return alert("Please enter both email and password.");

  showLoading(true);
  try {
    await auth.signInWithEmailAndPassword(email, password);
  } catch (error) {
    showLoading(false);
    alert("Auth Failed: " + error.message);
  }
}

function logout() {
  if (unsubscribeListener) unsubscribeListener();
  if (unsubscribeAnnouncements) unsubscribeAnnouncements();
  auth.signOut();
}

async function openRoleModal() {
  if (currentUserData && currentUserData.name === 'muffintoughen') {
    showLoading(true);
    const dropdown = document.getElementById('user-select-dropdown');
    if (!dropdown) return;
    dropdown.innerHTML = '';
    
    try {
      const usersSnap = await db.collection('users').get();
      usersSnap.forEach(doc => {
        const data = doc.data();
        const opt = document.createElement('option');
        opt.value = doc.id;
        opt.innerText = `${data.name || 'User'} (${(data.roles || []).join(', ')})`;
        dropdown.appendChild(opt);
      });
    } catch (err) {
      console.error(err);
    }

    showLoading(false);
    const modal = document.getElementById('role-modal');
    if (modal) modal.style.display = 'flex';
  }
}

function closeRoleModal() {
  const modal = document.getElementById('role-modal');
  if (modal) modal.style.display = 'none';
}

async function saveTargetUserRoles() {
  const dropdown = document.getElementById('user-select-dropdown');
  const input = document.getElementById('custom-role-input');
  if (!dropdown || !input) return;

  const targetUid = dropdown.value;
  const rawRoles = input.value.trim();
  if (!targetUid || !rawRoles) return;
  
  const rolesArray = rawRoles.split(',').map(r => r.trim()).filter(r => r.length > 0);

  showLoading(true);
  await db.collection('users').doc(targetUid).set({ roles: rolesArray }, { merge: true });
  showLoading(false);

  closeRoleModal();
  loadRoomMessages(currentRoom);
}

async function openUserProfile(name) {
  showLoading(true);
  try {
    const usersSnap = await db.collection('users').where('name', '==', name).get();
    
    if (!usersSnap.empty) {
      const userData = usersSnap.docs[0].data();
      const nameEl = document.getElementById('profile-name');
      const emailEl = document.getElementById('profile-email');
      const container = document.getElementById('profile-roles-container');
      
      if (nameEl) {
        nameEl.innerText = userData.name || name;
        nameEl.style.color = getUserColor(userData.name || name);
      }
      if (emailEl) emailEl.innerText = userData.email || 'No email registered';
      
      if (container) {
        container.innerHTML = '';
        const roles = userData.roles || (userData.role ? [userData.role] : ['Member']);
        roles.forEach(r => {
          const badge = document.createElement('span');
          badge.className = 'role-badge';
          badge.innerText = r;
          container.appendChild(badge);
        });
      }

      const modal = document.getElementById('profile-modal');
      if (modal) modal.style.display = 'flex';
    }
  } catch (e) {
    console.error(e);
  }
  showLoading(false);
}

function closeProfileModal() {
  const modal = document.getElementById('profile-modal');
  if (modal) modal.style.display = 'none';
}

function switchRoom(roomName) {
  currentRoom = roomName;
  const title = document.getElementById('current-room-title');
  if (title) title.innerHTML = `<i class="fa-solid fa-hashtag"></i> ${roomName}`;
  
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.remove('active');
    if(btn.innerText.toLowerCase().includes(roomName.toLowerCase())) {
      btn.classList.add('active');
    }
  });

  if (roomName === 'audit-logs') {
    loadAuditLogs();
  } else {
    loadRoomMessages(roomName);
    listenTypingStatus();
  }
}

function formatText(text) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return text.replace(urlRegex, url => `<a href="${url}" target="_blank" style="color:#a855f7;text-decoration:underline;">${url}</a>`);
}

function loadRoomMessages(room) {
  const container = document.getElementById('message-container');
  if (!container) return;

  if (unsubscribeListener) unsubscribeListener();

  unsubscribeListener = db.collection('rooms').doc(room).collection('messages')
    .orderBy('timestamp', 'asc')
    .onSnapshot(snapshot => {
      container.innerHTML = '';
      snapshot.forEach(doc => {
        const msg = doc.data();
        const msgId = doc.id;
        const div = document.createElement('div');
        div.className = 'message';
        
        const isOwnerMsg = (currentUserData && msg.name === currentUserData.name);
        
        let actionsHtml = '';
        if (isOwnerMsg) {
          actionsHtml = `
            <div class="msg-actions">
              <button class="action-btn" onclick="editMessage('${msgId}', '${escape(msg.text || '')}')" title="Edit"><i class="fa-solid fa-pen"></i></button>
              <button class="action-btn" onclick="deleteMessage('${msgId}', '${escape(msg.text || '')}')" title="Delete"><i class="fa-solid fa-trash"></i></button>
            </div>
          `;
        }

        let mediaHtml = '';
        if (msg.fileUrl) {
          if (msg.fileType && msg.fileType.startsWith('image/')) {
            mediaHtml = `<img src="${msg.fileUrl}" class="msg-image" style="cursor:pointer;" onclick="openLightbox('${msg.fileUrl}')" />`;
          } else {
            mediaHtml = `<a href="${msg.fileUrl}" download="${msg.fileName || 'Attachment'}" class="msg-file-btn" target="_blank"><i class="fa-solid fa-file-arrow-down"></i> ${msg.fileName || 'Attachment'}</a>`;
          }
        }

        const authorName = msg.name || 'Anonymous';
        const nameColor = getUserColor(authorName);

        // Render header with inline color styling & without main-chat role badges
        div.innerHTML = `
          ${actionsHtml}
          <div class="msg-header">
            <span class="msg-author" style="color: ${nameColor} !important;" onclick="openUserProfile('${authorName}')">${authorName}</span>
          </div>
          <div class="msg-text">${formatText(msg.text || '')}${msg.edited ? '<span class="msg-edited">(edited)</span>' : ''}</div>
          ${mediaHtml}
        `;
        container.appendChild(div);
      });
      container.scrollTop = container.scrollHeight;
    });
}

function sendMessage(fileData = null) {
  const input = document.getElementById('message-input');
  if (!input) return;
  const text = input.value.trim();

  if (!text && !fileData) return;
  if (!currentUserData) return;

  const msgPayload = {
    name: currentUserData.name,
    roles: currentUserData.roles || (currentUserData.role ? [currentUserData.role] : ['Member']),
    text: text,
    timestamp: firebase.firestore.FieldValue.serverTimestamp()
  };

  if (fileData) {
    msgPayload.fileUrl = fileData.url;
    msgPayload.fileName = fileData.name;
    msgPayload.fileType = fileData.type;
  }

  db.collection('rooms').doc(currentRoom).collection('messages').add(msgPayload);
  input.value = '';
  updateTypingStatus(false);
}

async function logActionToAudit(actionType, originalText, newText = '') {
  try {
    await db.collection('audit_logs').add({
      action: actionType,
      author: currentUserData ? currentUserData.name : 'Unknown',
      room: currentRoom,
      originalText: unescape(originalText),
      newText: newText,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) {
    console.error("Failed to store log:", e);
  }
}

async function editMessage(msgId, currentText) {
  const oldText = unescape(currentText);
  const newText = prompt("Edit your message:", oldText);
  if (newText !== null && newText.trim() !== "" && newText.trim() !== oldText) {
    await db.collection('rooms').doc(currentRoom).collection('messages').doc(msgId).update({
      text: newText.trim(),
      edited: true
    });
    logActionToAudit("EDIT", oldText, newText.trim());
  }
}

async function deleteMessage(msgId, currentText) {
  if (confirm("Delete this message?")) {
    const oldText = unescape(currentText);
    await db.collection('rooms').doc(currentRoom).collection('messages').doc(msgId).delete();
    logActionToAudit("DELETE", oldText);
  }
}

function loadAuditLogs() {
  const container = document.getElementById('message-container');
  if (!container) return;

  if (unsubscribeListener) unsubscribeListener();

  unsubscribeListener = db.collection('audit_logs')
    .orderBy('timestamp', 'asc')
    .onSnapshot(snapshot => {
      container.innerHTML = '';
      snapshot.forEach(doc => {
        const log = doc.data();
        const div = document.createElement('div');
        div.className = 'message';
        div.style.borderLeft = log.action === 'DELETE' ? '4px solid #ef4444' : '4px solid #f59e0b';
        div.style.paddingLeft = '10px';

        const timeStr = log.timestamp ? new Date(log.timestamp.toDate()).toLocaleString() : 'Just now';

        div.innerHTML = `
          <div class="msg-header">
            <span class="msg-author" style="color: ${log.action === 'DELETE' ? '#ef4444' : '#f59e0b'}">[${log.action}] by ${log.author}</span>
            <span style="font-size: 11px; opacity: 0.6; margin-left: 8px;">(${log.room} • ${timeStr})</span>
          </div>
          <div class="msg-text">
            ${log.action === 'DELETE' ? `<b>Deleted Msg:</b> ${formatText(log.originalText)}` : `<b>Original:</b> ${formatText(log.originalText)} <br><b>Updated To:</b> ${formatText(log.newText)}`}
          </div>
        `;
        container.appendChild(div);
      });
      container.scrollTop = container.scrollHeight;
    });
}

// Realtime Announcements Listener
function openAnnouncementsModal() {
  const modal = document.getElementById('announcement-modal');
  const inputContainer = document.getElementById('announcement-input-container');
  if (!modal) return;

  if (currentUserData && currentUserData.name === 'muffintoughen') {
    if (inputContainer) inputContainer.style.display = 'flex';
  } else {
    if (inputContainer) inputContainer.style.display = 'none';
  }

  modal.style.display = 'flex';
  startRealtimeAnnouncements();
}

function closeAnnouncementsModal() {
  const modal = document.getElementById('announcement-modal');
  if (modal) modal.style.display = 'none';
}

async function postAnnouncement() {
  const textInput = document.getElementById('announcement-text');
  if (!textInput) return;
  const text = textInput.value.trim();
  if (!text) return;

  showLoading(true);
  try {
    await db.collection('announcements').add({
      author: currentUserData.name,
      text: text,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
    textInput.value = '';
  } catch (e) {
    console.error("Announcement error:", e);
  }
  showLoading(false);
}

function startRealtimeAnnouncements() {
  const listContainer = document.getElementById('announcement-list');
  if (!listContainer) return;

  if (unsubscribeAnnouncements) unsubscribeAnnouncements();

  unsubscribeAnnouncements = db.collection('announcements').orderBy('timestamp', 'desc').onSnapshot(snapshot => {
    listContainer.innerHTML = '';
    if (snapshot.empty) {
      listContainer.innerHTML = '<div style="opacity: 0.6; font-size: 14px;">No announcements yet.</div>';
      return;
    }
    snapshot.forEach(doc => {
      const data = doc.data();
      const div = document.createElement('div');
      div.style.cssText = 'background:#232330;padding:10px;border-radius:6px;border-left:4px solid #a855f7;';
      div.innerHTML = `
        <div style="font-weight:bold;font-size:12px;color:#a855f7;margin-bottom:4px;">${data.author || 'Admin'}</div>
        <div style="font-size:14px;white-space:pre-wrap;">${formatText(data.text || '')}</div>
      `;
      listContainer.appendChild(div);
    });
  });
}

// File & Image Upload Progress Indicator
function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const maxSizeBytes = 10 * 1024 * 1024; // 10 MB strict limit
  if (file.size > maxSizeBytes) { 
    alert("File is too large! Maximum allowed size is 10 MB.");
    event.target.value = '';
    return;
  }

  const container = document.getElementById('message-container');
  const tempMsgId = 'temp-upload-' + Date.now();
  const tempDiv = document.createElement('div');
  tempDiv.className = 'message';
  tempDiv.id = tempMsgId;

  tempDiv.innerHTML = `
    <div class="msg-header">
      <span class="msg-author" style="color:${getUserColor(currentUserData.name)}">${currentUserData.name}</span>
    </div>
    <div style="background:#232330;padding:12px;border-radius:6px;display:flex;flex-direction:column;gap:8px;max-width:260px;margin-top:4px;">
      <div style="display:flex;align-items:center;gap:10px;font-size:13px;color:#aaa;">
        <i class="fa-solid fa-spinner fa-spin" style="color:#a855f7;font-size:16px;"></i> Uploading ${file.name}...
      </div>
      <div style="width:100%;background:#323245;height:6px;border-radius:3px;overflow:hidden;">
        <div id="${tempMsgId}-bar" style="width:0%;height:100%;background:linear-gradient(90deg, #a855f7, #ec4899);transition:width 0.2s ease;"></div>
      </div>
    </div>
  `;

  if (container) {
    container.appendChild(tempDiv);
    container.scrollTop = container.scrollHeight;
  }

  showLoading(true);

  const reader = new FileReader();
  
  reader.onprogress = function (e) {
    if (e.lengthComputable) {
      const percent = Math.round((e.loaded / e.total) * 100);
      const progressBar = document.getElementById(`${tempMsgId}-bar`);
      if (progressBar) progressBar.style.width = percent + '%';
    }
  };

  reader.onload = function (e) {
    const tempElement = document.getElementById(tempMsgId);
    if (tempElement) tempElement.remove();

    sendMessage({
      url: e.target.result,
      name: file.name,
      type: file.type || 'application/octet-stream'
    });

    showLoading(false);
    event.target.value = '';
  };

  reader.onerror = function (error) {
    console.error("File reading error:", error);
    alert("Failed to read file.");
    const tempElement = document.getElementById(tempMsgId);
    if (tempElement) tempElement.remove();
    showLoading(false);
    event.target.value = '';
  };

  reader.readAsDataURL(file);
}

// Live Typing Indicator Listeners
function attachTypingEvents() {
  const input = document.getElementById('message-input');
  if (!input) return;

  input.addEventListener('input', () => {
    updateTypingStatus(true);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => updateTypingStatus(false), 2000);
  });
}

function updateTypingStatus(isTyping) {
  if (!currentUserData) return;
  db.collection('rooms').doc(currentRoom).collection('typing').doc(currentUserData.name).set({
    typing: isTyping,
    timestamp: firebase.firestore.FieldValue.serverTimestamp()
  });
}

function listenTypingStatus() {
  const bar = document.getElementById('typing-indicator-bar');
  if (!bar) return;

  db.collection('rooms').doc(currentRoom).collection('typing').onSnapshot(snap => {
    const typers = [];
    snap.forEach(doc => {
      const data = doc.data();
      if (data.typing && doc.id !== currentUserData?.name) {
        typers.push(doc.id);
      }
    });

    if (typers.length > 0) {
      bar.innerText = `${typers.join(', ')} ${typers.length === 1 ? 'is' : 'are'} typing...`;
    } else {
      bar.innerText = '';
    }
  });
}
