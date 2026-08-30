const firebaseConfig = {
  apiKey: "AIzaSyBQJ85vIe3bvFX9VXuEvUmCKpyhX2MNmfo",
  authDomain: "teamchatapp-5877c.firebaseapp.com",
  projectId: "teamchatapp-5877c",
  storageBucket: "teamchatapp-5877c.firebasestorage.app",
  messagingSenderId: "999662431586",
  appId: "1:999662431586:web:69ac0aaecd7f2a0c1d103b"
};

// Initialize Firebase
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();

let currentUser = { name: '', role: '' };
let currentRoom = 'general';
let unsubscribeListener = null;

// Join Team Function
function joinTeam() {
  const nameInput = document.getElementById('username-input').value.trim();
  const roleSelect = document.getElementById('role-select').value;

  if (!nameInput) {
    alert("Please enter your name!");
    return;
  }

  currentUser.name = nameInput;
  currentUser.role = roleSelect;

  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-screen').style.display = 'flex';

  loadRoomMessages('general');
}

// Switch Chat Rooms
function switchRoom(roomName) {
  currentRoom = roomName;
  document.getElementById('current-room-title').innerText = `# ${roomName}`;
  
  document.querySelectorAll('.room-btn').forEach(btn => {
    btn.classList.toggle('active', btn.innerText.includes(roomName));
  });

  loadRoomMessages(roomName);
}

// Load Real-time Messages
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
        div.innerHTML = `
          <div class="author">${msg.name || 'Anonymous'} (${msg.role || 'Member'})</div>
          <div class="text">${msg.text}</div>
        `;
        container.appendChild(div);
      });
      container.scrollTop = container.scrollHeight;
    }, error => {
      console.error("Firestore Read Error: ", error);
    });
}

// Send Message
function sendMessage() {
  const input = document.getElementById('message-input');
  const text = input.value.trim();

  if (!text) return;

  db.collection('rooms').doc(currentRoom).collection('messages').add({
    name: currentUser.name,
    role: currentUser.role,
    text: text,
    timestamp: firebase.firestore.FieldValue.serverTimestamp()
  }).catch(error => {
    console.error("Firestore Write Error: ", error);
    alert("Permission Error! Check your Firebase Rules.");
  });

  input.value = '';
}