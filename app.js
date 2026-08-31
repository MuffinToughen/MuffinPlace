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

auth.onAuthStateChanged(async (user) => {
  const authScreen = document.getElementById('auth-screen');
  const appScreen = document.getElementById('app-screen');

  if (user) {
    try {
      const userDoc = await db.collection('users').doc(user.uid).get();
      if (userDoc.exists) {
        currentUserData = userDoc.data();
      } else {
        currentUserData = { name: user.email.split('@')[0], role: 'Member' };
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
    alert("Please enter your email and password.");
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
        const div = document.createElement('div');
        div.className = 'message';
        
        const roleClass = 'role-' + (msg.role || 'Member').toLowerCase().replace(/\s+/g, '-');
        
        div.innerHTML = `
          <div class="msg-header">
            <span class="msg-author">${msg.name || 'Anonymous'}</span>
            <span class="role-badge ${roleClass}">${msg.role || 'Member'}</span>
          </div>
          <div class="msg-text">${formatText(msg.text || '')}</div>
        `;
        container.appendChild(div);
      });
      container.scrollTop = container.scrollHeight;
    }, error => {
      console.error("Firestore Read Error: ", error);
    });
}

function sendMessage() {
  const input = document.getElementById('message-input');
  const text = input.value.trim();

  if (!text || !currentUserData) return;

  db.collection('rooms').doc(currentRoom).collection('messages').add({
    name: currentUserData.name,
    role: currentUserData.role,
    text: text,
    timestamp: firebase.firestore.FieldValue.serverTimestamp()
  }).catch(error => {
    console.error("Firestore Write Error: ", error);
  });

  input.value = '';
}
