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

auth.onAuthStateChanged(async (user) => {
  showLoading(true);
  const authScreen = document.getElementById('auth-screen');
  const appScreen = document.getElementById('app-screen');
  const roleBtn = document.getElementById('role-btn');

  if (user) {
    try {
      const userDoc = await db.collection('users').doc(user.uid).get();
      const username = user.email.split('@')[0];
      
      if (userDoc.exists) {
        currentUserData = userDoc.data();
      } else {
        const defaultRoles = (username === 'muffintoughen') ? ['OWNER', 'BOSS'] : ['Member'];
        currentUserData = { name: username, email: user.email, roles: defaultRoles };
        await db.collection('users').doc(user.uid).set(currentUserData);
      }

      if (roleBtn) {
        roleBtn.style.display = (username === 'muffintoughen') ? 'flex' : 'none';
      }

    } catch (e) {
      console.error(e);
      currentUserData = { name: user.email.split('@')[0], roles: ['Member'] };
    }
    
    if (authScreen) authScreen.style.display = 'none';
    if (appScreen) appScreen.style.display = 'flex';
    loadRoomMessages('general');
  } else {
    if (authScreen) authScreen.style.display = 'flex';
    if (appScreen) appScreen.style.display = 'none';
  }
  showLoading(false);
});

async function handleAuth() {
  const emailInput = document.getElementById('email-input');
  const passwordInput = document.getElementById('password-input');
  
  if (!emailInput || !passwordInput) return;

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    alert("Please enter credentials.");
    return;
  }

  showLoading(true);
  try {
    await auth.signInWithEmailAndPassword(email, password);
  } catch (error) {
    alert("Login failed: " + error.message);
  }
  showLoading(false);
}

function logout() {
  auth.signOut();
}

async function openRoleModal() {
  if (currentUserData && currentUserData.name === 'muffintoughen') {
    showLoading(true);
    const dropdown = document.getElementById('user-select-dropdown');
    if (!dropdown) return;
    
    dropdown.innerHTML = '';
    
    const usersSnap = await db.collection('users').get();
    usersSnap.forEach(doc => {
      const data = doc.data();
      const opt = document.createElement('option');
      opt.value = doc.id;
      opt.innerText = `${data.name || 'User'} (${(data.roles || []).join(', ')})`;
      dropdown.appendChild(opt);
    });

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
  container.innerHTML = '';

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
            mediaHtml = `<a href="${msg.fileUrl}" download="${msg.fileName || 'Attachment'}" class="msg-file-btn"><i class="fa-solid fa-file-arrow-down"></i> ${msg.fileName || 'Attachment'}</a>`;
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

function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (file.size > 10485760) { 
    alert("File size too large for quick upload (max 10MB).");
    return;
  }

  showLoading(true);
  const reader = new FileReader();
  reader.onload = function(e) {
    sendMessage({
      url: e.target.result,
      name: file.name,
      type: file.type
    });
    showLoading(false);
  };
  reader.readAsDataURL(file);
}
