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

// Authentication State Observer
auth.onAuthStateChanged(async (user) => {
  showLoading(true);
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
    if(btn.innerText.toLowerCase().includes(roomName)) {
      btn.classList.add('active');
    }
  });

  loadRoomMessages(roomName);
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
              <button class="action-btn" onclick="deleteMessage('${msgId}')" title="Delete"><i class="fa-solid fa-trash"></i></button>
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

async function editMessage(msgId, currentText) {
  const newText = prompt("Edit your message:", unescape(currentText));
  if (newText !== null && newText.trim() !== "") {
    await db.collection('rooms').doc(currentRoom).collection('messages').doc(msgId).update({
      text: newText.trim(),
      edited: true
    });
  }
}

async function deleteMessage(msgId) {
  if (confirm("Delete this message?")) {
    await db.collection('rooms').doc(currentRoom).collection('messages').doc(msgId).delete();
  }
}

// 200MB Any-File Uploader via Catbox API
async function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const maxSizeBytes = 200 * 1024 * 1024; // 200 MB limit
  if (file.size > maxSizeBytes) { 
    alert("File is too large! Maximum size limit is 200 MB.");
    return;
  }

  showLoading(true);

  try {
    const formData = new FormData();
    formData.append("reqtype", "fileupload");
    formData.append("fileToUpload", file);

    const response = await fetch("https://corsproxy.io/?" + encodeURIComponent("https://catbox.moe/user/api.php"), {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      throw new Error("Server responded with status " + response.status);
    }

    const fileUrl = await response.text();

    if (fileUrl && fileUrl.startsWith("http")) {
      sendMessage({
        url: fileUrl.trim(),
        name: file.name,
        type: file.type || 'application/octet-stream'
      });
    } else {
      alert("Upload failed. Try again.");
    }

  } catch (error) {
    console.error("Upload error:", error);
    alert("Upload failed: " + error.message);
  } finally {
    showLoading(false);
    event.target.value = '';
  }
}
