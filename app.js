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

function showLoading(show = true) {
  const loader = document.getElementById('loading-screen');
  if (loader) loader.style.display = show ? 'flex' : 'none';
}

// Ensure Announcement floating ring button exists in DOM
function setupAnnouncementUI() {
  if (document.getElementById('announcement-ring-btn')) return;

  const btn = document.createElement('button');
  btn.id = 'announcement-ring-btn';
  btn.innerHTML = '<i class="fa-solid fa-bell"></i>';
  btn.style.cssText = 'position:fixed;bottom:20px;right:20px;width:50px;height:50px;border-radius:50%;background:#7289da;color:#fff;border:none;cursor:pointer;font-size:20px;box-shadow:0 4px 10px rgba(0,0,0,0.3);z-index:9999;display:flex;align-items:center;justify-content:center;';
  btn.onclick = openAnnouncementsModal;
  document.body.appendChild(btn);

  const modal = document.createElement('div');
  modal.id = 'announcement-modal';
  modal.style.cssText = 'display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:10000;align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div style="background:#2f3136;color:#fff;padding:20px;border-radius:8px;width:90%;max-width:500px;max-height:80vh;display:flex;flex-direction:column;gap:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <h3 style="margin:0;"><i class="fa-solid fa-bullhorn"></i> Announcements</h3>
        <button onclick="closeAnnouncementsModal()" style="background:none;border:none;color:#fff;cursor:pointer;font-size:18px;">✕</button>
      </div>
      <div id="announcement-input-container" style="display:none;flex-direction:column;gap:8px;">
        <textarea id="announcement-text" placeholder="Write announcement..." style="width:100%;height:60px;background:#40444b;border:none;color:#fff;padding:8px;border-radius:4px;resize:none;"></textarea>
        <button onclick="postAnnouncement()" style="background:#7289da;color:#fff;border:none;padding:8px;border-radius:4px;cursor:pointer;font-weight:bold;">Post Announcement</button>
      </div>
      <div id="announcement-list" style="overflow-y:auto;max-height:50vh;display:flex;flex-direction:column;gap:10px;margin-top:10px;"></div>
    </div>
  `;
  document.body.appendChild(modal);
}

// Setup Admin Log Room Button
function setupAuditLogRoomUI() {
  const isOwner = currentUserData && currentUserData.name === 'muffintoughen';
  let navBtn = document.getElementById('audit-log-nav-btn');

  if (isOwner) {
    if (!navBtn) {
      const sidebar = document.querySelector('.sidebar') || document.querySelector('nav');
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

// Authentication State Observer
auth.onAuthStateChanged(async (user) => {
  showLoading(true);
  setupAnnouncementUI();

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
    if (authScreen) authScreen.style.display = 'none';
    if (appScreen) appScreen.style.display = 'flex';
    loadRoomMessages('general');
  } else {
    currentUserData = null;
    if (authScreen) authScreen.style.display = 'flex';
    if (appScreen) appScreen.style.display = 'none';
  }
  showLoading(false);
});

// Explicit Handle Login Function
async function handleAuth() {
  const emailInput = document.getElementById('email-input');
  const passwordInput = document.getElementById('password-input');

  if (!emailInput || !passwordInput) {
    alert("UI elements missing. Refresh page.");
    return;
  }

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    alert("Please enter both email and password.");
    return;
  }

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
  auth.signOut();
}

// Admin Role Panel
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

// Profile Card
async function openUserProfile(name) {
  showLoading(true);
  try {
    const usersSnap = await db.collection('users').where('name', '==', name).get();
    
    if (!usersSnap.empty) {
      const userData = usersSnap.docs[0].data();
      const nameEl = document.getElementById('profile-name');
      const emailEl = document.getElementById('profile-email');
      const container = document.getElementById('profile-roles-container');
      
      if (nameEl) nameEl.innerText = userData.name || name;
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
  }
}

function formatText(text) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return text.replace(urlRegex, url => `<a href="${url}" target="_blank" class="msg-link">${url}</a>`);
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

        let rolesHtml = '';
        const rolesList = msg.roles || (msg.role ? [msg.role] : ['Member']);
        rolesList.forEach(r => {
          rolesHtml += `<span class="role-badge">${r}</span>`;
        });

        let mediaHtml = '';
        if (msg.fileUrl) {
          if (msg.fileType && msg.fileType.startsWith('image/')) {
            mediaHtml = `<img src="${msg.fileUrl}" class="msg-image" />`;
          } else {
            mediaHtml = `<a href="${msg.fileUrl}" download="${msg.fileName || 'Attachment'}" class="msg-file-btn" target="_blank"><i class="fa-solid fa-file-arrow-down"></i> ${msg.fileName || 'Attachment'}</a>`;
          }
        }

        div.innerHTML = `
          ${actionsHtml}
          <div class="msg-header">
            <span class="msg-author" onclick="openUserProfile('${msg.name}')">${msg.name || 'Anonymous'}</span>
            ${rolesHtml}
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
}

// Log actions (edits & deletions) to private Audit Log collection
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

// Loads private Audit Log messages (muffintoughen only)
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
        div.style.borderLeft = log.action === 'DELETE' ? '4px solid #f04747' : '4px solid #faa61a';
        div.style.paddingLeft = '10px';

        const timeStr = log.timestamp ? new Date(log.timestamp.toDate()).toLocaleString() : 'Just now';

        div.innerHTML = `
          <div class="msg-header">
            <span class="msg-author" style="color: ${log.action === 'DELETE' ? '#f04747' : '#faa61a'}">[${log.action}] by ${log.author}</span>
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

// Announcements System
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
  fetchAnnouncements();
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
    fetchAnnouncements();
  } catch (e) {
    console.error("Announcement error:", e);
  }
  showLoading(false);
}

function fetchAnnouncements() {
  const listContainer = document.getElementById('announcement-list');
  if (!listContainer) return;

  db.collection('announcements').orderBy('timestamp', 'desc').get().then(snapshot => {
    listContainer.innerHTML = '';
    if (snapshot.empty) {
      listContainer.innerHTML = '<div style="opacity: 0.6; font-size: 14px;">No announcements yet.</div>';
      return;
    }
    snapshot.forEach(doc => {
      const data = doc.data();
      const div = document.createElement('div');
      div.style.cssText = 'background:#36393f;padding:10px;border-radius:6px;border-left:4px solid #7289da;';
      div.innerHTML = `
        <div style="font-weight:bold;font-size:12px;color:#7289da;margin-bottom:4px;">${data.author || 'Admin'}</div>
        <div style="font-size:14px;white-space:pre-wrap;">${formatText(data.text || '')}</div>
      `;
      listContainer.appendChild(div);
    });
  });
}

// Base64 File Uploader with 10MB strict limit
function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const maxSizeBytes = 10 * 1024 * 1024; // 10 MB limit
  if (file.size > maxSizeBytes) { 
    alert("File is too large! Maximum allowed size is 10 MB.");
    event.target.value = '';
    return;
  }

  showLoading(true);

  const reader = new FileReader();
  reader.onload = function (e) {
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
    showLoading(false);
    event.target.value = '';
  };

  reader.readAsDataURL(file);
}
