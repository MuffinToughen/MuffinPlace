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
const storage = firebase.storage();

let currentUserData = null;
let currentRoom = 'general';
let unsubscribeListener = null;

auth.onAuthStateChanged(async (user) => {
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
        const defaultRole = (username === 'muffintoughen') ? 'OWNER' : 'Member';
        currentUserData = { name: username, role: defaultRole };
        await db.collection('users').doc(user.uid).set(currentUserData);
      }

      if (username === 'muffintoughen') {
        roleBtn.style.display = 'flex';
      } else {
        roleBtn.style.display = 'none';
      }

    } catch (e) {
      currentUserData = { name: user.email.split('@')[0], role: 'Member' };
    }
    
    if (authScreen) authScreen.style.display = 'none';
    if (appScreen) appScreen.style.display = 'flex';
    loadRoomMessages('general');
  } else {
    if (authScreen) authScreen.style.display = 'flex';
    if (appScreen) appScreen.style.display = 'none';
  }
});

async function handleAuth() {
  const email = document.getElementById('email-input').value.trim();
  const password = document.getElementById('password-input').value;

  if (!email || !password) {
    alert("Please enter credentials.");
    return;
  }

  try {
    await auth.signInWithEmailAndPassword(email, password);
  } catch (error) {
    alert("Login failed: " + error.message);
  }
}

function logout() {
  auth.signOut();
}

function openRoleModal() {
  if (currentUserData && currentUserData.name === 'muffintoughen') {
    document.getElementById('role-modal').style.display = 'flex';
  }
}

function closeRoleModal() {
  document.getElementById('role-modal').style.display = 'none';
}

async function saveUserRole() {
  const newRole = document.getElementById('custom-role-input').value.trim();
  const user = auth.currentUser;
  
  if (!newRole || !user) return;

  currentUserData.role = newRole;
  await db.collection('users').doc(user.uid).set(currentUserData, { merge: true });
  closeRoleModal();
  loadRoomMessages(currentRoom);
}

function switchRoom(roomName) {
  currentRoom = roomName;
  document.getElementById('current-room-title').innerHTML = `<i class="fa-solid fa-hashtag"></i> ${roomName}`;
  
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

        let mediaHtml = '';
        if (msg.fileUrl) {
          if (msg.fileType && msg.fileType.startsWith('image/')) {
            mediaHtml = `<img src="${msg.fileUrl}" class="msg-image" />`;
          } else {
            mediaHtml = `<a href="${msg.fileUrl}" target="_blank" class="msg-file-btn"><i class="fa-solid fa-file-arrow-down"></i> ${msg.fileName || 'Attachment'}</a>`;
          }
        }

        div.innerHTML = `
          ${actionsHtml}
          <div class="msg-header">
            <span class="msg-author">${msg.name || 'Anonymous'}</span>
            <span class="role-badge">${msg.role || 'Member'}</span>
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
  const text = input.value.trim();

  if (!text && !fileData) return;
  if (!currentUserData) return;

  const msgPayload = {
    name: currentUserData.name,
    role: currentUserData.role,
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

async function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const storageRef = storage.ref(`uploads/${Date.now()}_${file.name}`);
  try {
    const snapshot = await storageRef.put(file);
    const downloadURL = await snapshot.ref.getDownloadURL();
    
    sendMessage({
      url: downloadURL,
      name: file.name,
      type: file.type
    });
  } catch (error) {
    alert("Upload failed: " + error.message);
  }
}
