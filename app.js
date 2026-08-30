const firebaseConfig = {
  apiKey: "AIzaSyBQJ85vIe3bvFX9VXuEvUmCKpyhX2MNmfo",
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
let isSignUpMode = false;

// Persistent Auth Listener: Keeps user logged in across page refreshes
auth.onAuthStateChanged(async (user) => {
  if (user) {
    const userDoc = await db.collection('users').doc(user.uid).get();
    if (userDoc.exists) {
      currentUserData = userDoc.data();
    } else {
      currentUserData = { name: user.email.split('@')[0], role: 'Member' };
    }
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('app-screen').style.display = 'flex';
    loadRoomMessages('general');
  } else {
    document.getElementById('auth-screen').style.display = 'flex';
    document.getElementById('app-screen').style.display = 'none';
  }
});

function toggleAuthMode() {
  isSignUpMode = !isSignUpMode;
  document.getElementById('signup-fields').style.display = isSignUpMode ? 'block' : 'none';
  document.getElementById('auth-title').innerText = isSignUpMode ? 'Create Account' : 'Splormb HQ';
  document.getElementById('auth-subtitle').innerText = isSignUpMode ? 'Register your team identity.' : 'Sign in to access your workspace.';
  document.getElementById('auth-btn').innerHTML = isSignUpMode ? '<i class="fa-solid fa-user-plus"></i> Register' : '<i class="fa-solid fa-right-to-bracket"></i> Login';
  document.getElementById('toggle-link').innerText = isSignUpMode ? 'Already have an account? Login' : 'Need an account? Register';
}

async function handleAuth() {
  const email = document.getElementById('email-input').value.trim();
  const password = document.getElementById('password-input').value;

  if (!email || !password) {
    alert("Please fill in both email and password.");
    return;
  }

  try {
    if (isSignUpMode) {
      const name = document.getElementById('username-input').value.trim();
      const role = document.getElementById('role-select').value;
      if (!name) { alert("Please enter a Display Name."); return; }

      const cred = await auth.createUserWithEmailAndPassword(email, password);
      await db.collection('users').doc(cred.user.uid).set({ name, role, email });
    } else {
      await auth.signInWithEmailAndPassword(email, password);
    }
  } catch (error) {
    alert(error.message);
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
