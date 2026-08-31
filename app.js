// ==========================================
// Muffins Place - Images Only / No Storage
// ==========================================
//
// Images are compressed in the browser and saved as
// Base64 data URLs inside Firestore.
//
// IMPORTANT:
// Firestore documents have a hard maximum size of ~1 MiB.
// This version limits the FINAL compressed image to 700 KB.
// Large images are resized/compressed automatically.
//
// Suitable for small chat images, NOT videos or large files.
// ==========================================

const firebaseConfig = {
  apiKey: "AIzaSyBQJ85vle3bvFX9VXuEvUmCKpyhX2MNmfo",
  authDomain: "teamchatapp-5877c.firebaseapp.com",
  projectId: "teamchatapp-5877c",
  storageBucket: "teamchatapp-5877c.firebasestorage.app",
  messagingSenderId: "999662431586",
  appId: "1:999662431586:web:69ac0aaecd7f2a0c1d103b"
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);

const db = firebase.firestore();
const auth = firebase.auth();

// Keep comfortably below Firestore's ~1 MiB document limit.
const MAX_FINAL_IMAGE_BYTES = 700 * 1024;
const MAX_IMAGE_DIMENSION = 1280;

const DEFAULT_ROLES = ["Member"];
const OWNER_USERNAMES = ["muffintoughen"];
const BUILT_IN_CHANNELS = ["general", "3d-animation", "voice-acting", "scripts"];

const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif"
];

let currentUserData = null;
let currentRoom = "general";
let editingMessageId = null;
let typingTimeout = null;
let unreadAnnouncementsCount = 0;
let announcementInitialized = false;
let channelRules = {};
let uiAudioContext = null;

const listeners = {
  messages: null,
  typing: null,
  announcementsBackground: null,
  announcementsList: null,
  channels: null
};

const $ = (id) => document.getElementById(id);


// ==========================================
// UTILITIES
// ==========================================

function showLoading(show = true) {
  $("loading-screen").hidden = !show;
}

function showToast(message, type = "success") {
  const toast = document.createElement("div");

  toast.className = `toast ${type}`;
  toast.textContent = message;

  $("toast-container").appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 4000);
}

function getUserColor(value = "") {
  let hash = 0;

  for (let i = 0; i < value.length; i++) {
    hash = value.charCodeAt(i) + ((hash << 5) - hash);
  }

  return `hsl(${Math.abs(hash) % 360}, 75%, 65%)`;
}

function formatTime(timestamp) {
  if (!timestamp || typeof timestamp.toDate !== "function") {
    return "Sending...";
  }

  return timestamp.toDate().toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function isOwner() {
  return currentUserData?.roles?.some(role =>
    String(role).toUpperCase() === "OWNER"
  );
}

function playUiSound(kind = "click") {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    uiAudioContext ||= new AudioContextClass();
    const context = uiAudioContext;
    context.resume?.().catch(() => {});
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    const tones = {
      click: [520, 0.025],
      send: [880, 0.075],
      announcement: [1040, 0.12],
      success: [700, 0.06],
      danger: [180, 0.07]
    };
    const [frequency, duration] = tones[kind] || tones.click;

    oscillator.type = kind === "danger" ? "triangle" : "sine";
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.045, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.01);
  } catch (_) {}
}

async function requestNotificationPermission() {
  if (!("Notification" in window) || Notification.permission !== "default") {
    return;
  }

  try {
    await Notification.requestPermission();
  } catch (_) {}
}

function showAnnouncementNotification(data) {
  if (!("Notification" in window) || Notification.permission !== "granted") {
    return;
  }

  try {
    new Notification("Muffins Place", {
      body: `New announcement from ${data.author || "Admin"}`,
      tag: "muffins-place-announcement"
    });
  } catch (_) {}
}

function isAdmin() {
  return currentUserData?.roles?.some(role =>
    ["OWNER", "ADMIN"].includes(String(role).toUpperCase())
  );
}

function normalizeRoles(value = "") {
  return [...new Set(
    String(value)
      .split(",")
      .map(role => role.trim().toUpperCase())
      .filter(Boolean)
  )];
}

function canPostInRoom(room = currentRoom) {
  if (isOwner()) return true;

  const allowedRoles = channelRules[room]?.allowedRoles || [];

  if (!allowedRoles.length) return true;

  const userRoles = (currentUserData?.roles || [])
    .map(role => String(role).toUpperCase());

  return allowedRoles.some(role => userRoles.includes(role));
}

function updatePostingPermission() {
  const allowed = canPostInRoom();
  const input = $("message-input");

  input.disabled = !allowed;
  $("send-btn").disabled = !allowed;
  $("file-upload").disabled = !allowed;
  $("file-upload-label").classList.toggle("is-disabled", !allowed);
  input.placeholder = allowed
    ? "Drop a message..."
    : "You do not have permission to post in this channel.";
}

function stopListener(name) {
  if (listeners[name]) {
    listeners[name]();
    listeners[name] = null;
  }
}

function stopAllListeners() {
  Object.keys(listeners).forEach(stopListener);
}

function safeText(value) {
  return typeof value === "string" ? value : "";
}

function appendTextWithLinks(container, text) {
  const regex = /(https?:\/\/[^\s]+)/g;
  const parts = safeText(text).split(regex);

  parts.forEach(part => {

    if (/^https?:\/\/[^\s]+$/i.test(part)) {

      try {
        const url = new URL(part);

        if (["http:", "https:"].includes(url.protocol)) {

          const link = document.createElement("a");

          link.href = url.href;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = part;

          container.appendChild(link);

          return;
        }

      } catch (_) {}

    }

    container.appendChild(document.createTextNode(part));

  });
}

function createIconButton(iconClass, label, className = "") {

  const button = document.createElement("button");

  button.type = "button";
  button.className = `action-btn ${className}`;

  button.setAttribute("aria-label", label);
  button.title = label;

  const icon = document.createElement("i");

  icon.className = iconClass;

  button.appendChild(icon);

  return button;
}

function autoResizeTextarea(textarea) {

  textarea.style.height = "auto";

  textarea.style.height =
    Math.min(textarea.scrollHeight, 150) + "px";

}


// ==========================================
// AUTHENTICATION
// ==========================================

async function signIn() {

  const email = $("email-input").value.trim();
  const password = $("password-input").value;

  if (!email || !password) {
    showToast("Enter your email and password.", "error");
    return;
  }

  showLoading(true);

  try {

    await auth.signInWithEmailAndPassword(
      email,
      password
    );

  } catch (error) {

    showToast(error.message, "error");

  } finally {

    showLoading(false);

  }
}


async function register() {

  const email = $("email-input").value.trim();
  const password = $("password-input").value;

  if (!email || !password) {
    showToast("Enter your email and password.", "error");
    return;
  }

  if (password.length < 6) {
    showToast(
      "Password must be at least 6 characters.",
      "error"
    );

    return;
  }

  showLoading(true);

  try {

    await auth.createUserWithEmailAndPassword(
      email,
      password
    );

  } catch (error) {

    showToast(error.message, "error");

  } finally {

    showLoading(false);

  }
}


async function logout() {

  stopAllListeners();

  currentUserData = null;

  await auth.signOut();

}


// ==========================================
// USER
// ==========================================

async function loadOrCreateUser(user) {

  const ref = db.collection("users").doc(user.uid);

  const snapshot = await ref.get();

  if (snapshot.exists) {

    const data = {
      uid: user.uid,
      ...snapshot.data()
    };

    const isConfiguredOwner = OWNER_USERNAMES.includes(
      String(data.name || "").trim().toLowerCase()
    );

    const hasOwnerRole = (data.roles || []).some(role =>
      String(role).toUpperCase() === "OWNER"
    );

    if (isConfiguredOwner && !hasOwnerRole) {
      data.roles = ["OWNER", ...(data.roles || DEFAULT_ROLES)];
      await ref.update({ roles: data.roles });
    }

    return data;

  }

  const name = user.email
    ? user.email.split("@")[0]
    : "User";

  const data = {

    name,

    roles: OWNER_USERNAMES.includes(name.toLowerCase())
      ? ["OWNER", ...DEFAULT_ROLES]
      : DEFAULT_ROLES,

    createdAt:
      firebase.firestore.FieldValue.serverTimestamp()

  };

  await ref.set(data);

  return {
    uid: user.uid,
    ...data
  };

}


function updateCurrentUserUI() {

  const name =
    currentUserData?.name || "User";

  const roles =
    currentUserData?.roles || DEFAULT_ROLES;

  $("current-user-name").textContent = name;

  $("current-user-role").textContent =
    roles.join(", ");

  $("current-user-avatar").textContent =
    name.charAt(0).toUpperCase();

  $("current-user-avatar").style.background =
    `linear-gradient(
      135deg,
      ${getUserColor(name)},
      #ec4899
    )`;

  $("admin-section").hidden = !isAdmin();

  $("announcement-compose").hidden = !isAdmin();

  $("channel-manager-btn").hidden = !isOwner();

  updatePostingPermission();

}


auth.onAuthStateChanged(async user => {

  stopAllListeners();

  if (!user) {

    $("auth-screen").hidden = false;

    $("app-screen").hidden = true;

    // A first-time mobile visitor has no saved Firebase session.
    // Do not leave the loading overlay on top of the sign-in screen.
    showLoading(false);

    return;
  }

  showLoading(true);

  try {

    currentUserData =
      await loadOrCreateUser(user);

    updateCurrentUserUI();

    $("auth-screen").hidden = true;

    $("app-screen").hidden = false;

    switchRoom("general", true);

    startAnnouncementBackgroundListener();

    startChannelListener();

  } catch (error) {

    console.error(error);

    showToast(
      "Failed to load your account.",
      "error"
    );

  } finally {

    showLoading(false);

  }

});


// ==========================================
// ROOMS
// ==========================================

function startChannelListener() {
  stopListener("channels");

  listeners.channels = db.collection("channels").onSnapshot(snapshot => {
    channelRules = {};

    snapshot.forEach(doc => {
      channelRules[doc.id] = { id: doc.id, ...doc.data() };
    });

    renderCustomChannels();
    renderChannelManager();
    updatePostingPermission();
  }, error => {
    console.error(error);
    showToast("Could not load channel settings.", "error");
  });
}

function renderCustomChannels() {
  const container = $("custom-channels");
  container.replaceChildren();

  Object.values(channelRules)
    .filter(channel => !BUILT_IN_CHANNELS.includes(channel.id))
    .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)))
    .forEach(channel => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "nav-btn";
      button.dataset.room = channel.id;
      button.innerHTML = '<i class="fa-solid fa-hashtag"></i>';
      button.appendChild(document.createTextNode(channel.name || channel.id));
      button.addEventListener("click", () => switchRoom(channel.id));
      container.appendChild(button);
    });
}

function switchRoom(roomName, force = false) {

  if (!force && roomName === currentRoom) {
    return;
  }

  currentRoom = roomName;

  document
    .querySelectorAll(".nav-btn[data-room]")
    .forEach(button => {

      button.classList.toggle(
        "active",
        button.dataset.room === roomName
      );

    });

  const title =
    $("current-room-title");

  title.replaceChildren();

  const icon =
    document.createElement("i");

  icon.className =
    "fa-solid fa-hashtag";

  title.append(
    icon,
    document.createTextNode(` ${roomName}`)
  );

  loadRoomMessages(roomName);

  listenTypingStatus(roomName);

  updateTypingStatus(false);

  updatePostingPermission();

  closeSidebar();

}


function loadRoomMessages(room) {

  stopListener("messages");

  const container =
    $("message-container");

  container.replaceChildren();

  listeners.messages =
    db.collection("rooms")
      .doc(room)
      .collection("messages")
      .orderBy("timestamp", "asc")
      .onSnapshot(
        snapshot => {

          container.replaceChildren();

          snapshot.forEach(doc => {

            container.appendChild(
              createMessageElement(
                doc.id,
                doc.data()
              )
            );

          });

          container.scrollTop =
            container.scrollHeight;

        },

        error => {

          console.error(error);

          showToast(
            "Could not load messages. Check Firestore rules.",
            "error"
          );

        }
      );

}


// ==========================================
// MESSAGE UI
// ==========================================

function createMessageElement(messageId, msg) {

  const message =
    document.createElement("article");

  message.className = "message message-enter";

  message.addEventListener("click", event => {
    if (
      !window.matchMedia("(max-width: 760px)").matches ||
      event.target.closest("button, a")
    ) {
      return;
    }

    const wasOpen = message.classList.contains("actions-open");

    document.querySelectorAll(".message.actions-open").forEach(item => {
      item.classList.remove("actions-open");
    });

    if (!wasOpen && message.querySelector(".msg-actions")) {
      message.classList.add("actions-open");
    }
  });

  const authorName =
    safeText(msg.name) || "Anonymous";


  const avatar =
    document.createElement("span");

  avatar.className =
    "avatar message-avatar";

  avatar.textContent =
    authorName.charAt(0).toUpperCase();

  avatar.style.background =
    `linear-gradient(
      135deg,
      ${getUserColor(authorName)},
      #ec4899
    )`;


  const header =
    document.createElement("div");

  header.className =
    "message-header";


  const authorButton =
    document.createElement("button");

  authorButton.type = "button";

  authorButton.className =
    "msg-author";

  authorButton.textContent =
    authorName;

  authorButton.style.color =
    getUserColor(authorName);

  authorButton.addEventListener(
    "click",
    () => openUserProfile(msg.uid)
  );


  const time =
    document.createElement("span");

  time.className = "msg-time";

  time.textContent =
    formatTime(msg.timestamp);


  header.append(
    authorButton,
    time
  );


  if (msg.edited) {

    const edited =
      document.createElement("span");

    edited.className = "msg-edited";

    edited.textContent =
      "(edited)";

    header.appendChild(edited);

  }


  const hasText =
    safeText(msg.text).trim().length > 0;


  message.append(
    avatar,
    header
  );


  if (hasText) {

    const text =
      document.createElement("div");

    text.className = "msg-text";

    appendTextWithLinks(
      text,
      msg.text
    );

    message.appendChild(text);

  }


  // IMAGE MESSAGE

  if (msg.imageData) {

    const image =
      document.createElement("img");

    image.className = "msg-image";

    image.src = msg.imageData;

    image.alt =
      msg.imageName || "Image attachment";

    image.loading = "lazy";

    image.addEventListener(
      "click",
      () => {
        openLightbox(msg.imageData);
      }
    );

    message.appendChild(image);

  }


  const currentUid =
    auth.currentUser?.uid;

  const isAuthor =
    msg.uid === currentUid;


  if (isAuthor || isAdmin()) {

    const actions =
      document.createElement("div");

    actions.className =
      "msg-actions";


    // Edit only text messages

    if (isAuthor && !msg.imageData) {

      const edit =
        createIconButton(
          "fa-solid fa-pen",
          "Edit message"
        );

      edit.addEventListener(
        "click",
        () => {

          openEditModal(
            messageId,
            msg.text || ""
          );

        }
      );

      actions.appendChild(edit);

    }


    const remove =
      createIconButton(
        "fa-solid fa-trash",
        "Delete message",
        "delete"
      );

    remove.addEventListener(
      "click",
      () => {
        deleteMessage(
          messageId,
          msg
        );
      }
    );

    actions.appendChild(remove);

    message.appendChild(actions);

  }


  return message;

}


// ==========================================
// SEND TEXT MESSAGE
// ==========================================

async function sendMessage() {

  const input =
    $("message-input");

  const text =
    input.value.trim();

  if (
    !text ||
    !currentUserData ||
    currentRoom === "audit-logs" ||
    !canPostInRoom()
  ) {
    return;
  }

  try {

    await db.collection("rooms")
      .doc(currentRoom)
      .collection("messages")
      .add({

        uid:
          auth.currentUser.uid,

        name:
          currentUserData.name,

        roles:
          currentUserData.roles || DEFAULT_ROLES,

        text,

        timestamp:
          firebase.firestore
            .FieldValue
            .serverTimestamp(),

        edited: false

      });


    input.value = "";

    autoResizeTextarea(input);

    updateTypingStatus(false);

    playUiSound("send");

  } catch (error) {

    console.error(error);

    showToast(
      "Message failed to send.",
      "error"
    );

  }

}


// ==========================================
// IMAGE COMPRESSION
// ==========================================

function readImage(file) {

  return new Promise(
    (resolve, reject) => {

      const reader =
        new FileReader();

      reader.onload = () => {

        const image =
          new Image();

        image.onload =
          () => resolve(image);

        image.onerror =
          () => reject(
            new Error(
              "Could not read image."
            )
          );

        image.src =
          reader.result;

      };

      reader.onerror =
        () => reject(
          new Error(
            "Could not read file."
          )
        );

      reader.readAsDataURL(file);

    }
  );

}


function canvasToBlob(
  canvas,
  quality
) {

  return new Promise(resolve => {

    canvas.toBlob(
      blob => resolve(blob),
      "image/jpeg",
      quality
    );

  });

}


async function compressImage(
  file,
  progressCallback = () => {}
) {

  progressCallback(15);

  const image =
    await readImage(file);


  let width =
    image.naturalWidth || image.width;

  let height =
    image.naturalHeight || image.height;


  if (!width || !height) {

    throw new Error(
      "Invalid image dimensions."
    );

  }


  const scale =
    Math.min(
      1,
      MAX_IMAGE_DIMENSION /
      Math.max(width, height)
    );


  width =
    Math.max(
      1,
      Math.round(width * scale)
    );

  height =
    Math.max(
      1,
      Math.round(height * scale)
    );


  const canvas =
    document.createElement("canvas");

  const context =
    canvas.getContext("2d");


  canvas.width = width;

  canvas.height = height;


  context.drawImage(
    image,
    0,
    0,
    width,
    height
  );


  progressCallback(40);


  let quality = 0.88;

  let blob =
    await canvasToBlob(
      canvas,
      quality
    );


  progressCallback(60);


  while (
    blob &&
    blob.size > MAX_FINAL_IMAGE_BYTES &&
    quality > 0.35
  ) {

    quality -= 0.08;

    blob =
      await canvasToBlob(
        canvas,
        quality
      );

  }


  // Resize further if necessary

  while (
    blob &&
    blob.size > MAX_FINAL_IMAGE_BYTES &&
    width > 320 &&
    height > 320
  ) {

    width =
      Math.round(width * 0.82);

    height =
      Math.round(height * 0.82);


    canvas.width = width;

    canvas.height = height;


    context.drawImage(
      image,
      0,
      0,
      width,
      height
    );


    quality = 0.8;

    blob =
      await canvasToBlob(
        canvas,
        quality
      );


    while (
      blob &&
      blob.size > MAX_FINAL_IMAGE_BYTES &&
      quality > 0.35
    ) {

      quality -= 0.08;

      blob =
        await canvasToBlob(
          canvas,
          quality
        );

    }

  }


  if (
    !blob ||
    blob.size > MAX_FINAL_IMAGE_BYTES
  ) {

    throw new Error(
      "This image could not be compressed enough for Firestore."
    );

  }


  progressCallback(85);


  const dataUrl =
    await new Promise(
      (resolve, reject) => {

        const reader =
          new FileReader();

        reader.onload =
          () => resolve(reader.result);

        reader.onerror =
          () => reject(
            new Error(
              "Could not encode image."
            )
          );

        reader.readAsDataURL(blob);

      }
    );


  progressCallback(100);


  return {

    dataUrl,

    width,

    height,

    size: blob.size,

    type: "image/jpeg"

  };

}


// ==========================================
// IMAGE PROGRESS UI
// ==========================================

function createImageProgress(imageName) {

  const element =
    document.createElement("article");

  element.className = "message";


  const card =
    document.createElement("div");

  card.className = "upload-card";


  const meta =
    document.createElement("div");

  meta.className = "upload-meta";

  meta.textContent =
    `Preparing ${imageName}`;


  const progress =
    document.createElement("div");

  progress.className =
    "upload-progress";


  const bar =
    document.createElement("div");

  progress.appendChild(bar);


  card.append(
    meta,
    progress
  );


  element.appendChild(card);


  return {
    element,
    bar,
    meta
  };

}


// ==========================================
// UPLOAD IMAGE
// ==========================================

async function uploadSelectedImage(file) {

  if (!file || !currentUserData) {
    return;
  }

  if (!canPostInRoom()) {
    showToast("You do not have permission to post in this channel.", "error");
    $("file-upload").value = "";
    return;
  }


  if (
    !ALLOWED_IMAGE_TYPES.includes(
      file.type
    )
  ) {

    showToast(
      "Only JPG, PNG, WebP and GIF images are allowed.",
      "error"
    );

    $("file-upload").value = "";

    return;
  }


  if (currentRoom === "audit-logs") {

    showToast(
      "Images cannot be posted in Audit Logs.",
      "error"
    );

    $("file-upload").value = "";

    return;
  }


  const progress =
    createImageProgress(file.name);


  $("message-container")
    .appendChild(
      progress.element
    );


  $("message-container").scrollTop =
    $("message-container").scrollHeight;


  try {

    const result =
      await compressImage(
        file,
        percent => {

          progress.bar.style.width =
            `${percent}%`;

          progress.meta.textContent =
            percent < 100
              ? `Compressing ${file.name}... ${percent}%`
              : `Sending ${file.name}...`;

        }
      );


    await db.collection("rooms")
      .doc(currentRoom)
      .collection("messages")
      .add({

        uid:
          auth.currentUser.uid,

        name:
          currentUserData.name,

        roles:
          currentUserData.roles || DEFAULT_ROLES,

        text: "",

        imageData:
          result.dataUrl,

        imageName:
          file.name,

        imageType:
          result.type,

        imageWidth:
          result.width,

        imageHeight:
          result.height,

        timestamp:
          firebase.firestore
            .FieldValue
            .serverTimestamp(),

        edited: false

      });


    progress.element.remove();


  } catch (error) {

    console.error(error);

    progress.element.remove();

    showToast(
      error.message ||
      "Image upload failed.",
      "error"
    );

  } finally {

    $("file-upload").value = "";

  }

}


// ==========================================
// EDIT MESSAGE
// ==========================================

function openEditModal(
  messageId,
  text
) {

  editingMessageId =
    messageId;

  $("edit-message-input").value =
    text;

  openModal("edit-modal");

  $("edit-message-input").focus();

}


async function saveEditedMessage() {

  if (!editingMessageId) {
    return;
  }


  const text =
    $("edit-message-input")
      .value
      .trim();


  if (!text) {

    showToast(
      "Message cannot be empty.",
      "error"
    );

    return;
  }


  try {

    const ref =
      db.collection("rooms")
        .doc(currentRoom)
        .collection("messages")
        .doc(editingMessageId);


    const snapshot =
      await ref.get();


    if (
      !snapshot.exists ||
      snapshot.data().uid !==
        auth.currentUser.uid
    ) {

      showToast(
        "You can only edit your own messages.",
        "error"
      );

      return;
    }


    const originalText =
      snapshot.data().text || "";


    await ref.update({

      text,

      edited: true,

      editedAt:
        firebase.firestore
          .FieldValue
          .serverTimestamp()

    });


    await logAction(
      "EDIT",
      originalText,
      text,
      snapshot.id
    );


    closeModal("edit-modal");

    editingMessageId = null;


  } catch (error) {

    console.error(error);

    showToast(
      "Could not edit message.",
      "error"
    );

  }

}


// ==========================================
// DELETE MESSAGE
// ==========================================

async function deleteMessage(
  messageId,
  msg
) {

  if (!confirm("Delete this message?")) {
    return;
  }


  const isAuthor =
    msg.uid ===
    auth.currentUser?.uid;


  if (!isAuthor && !isAdmin()) {

    showToast(
      "You do not have permission to delete this message.",
      "error"
    );

    return;
  }


  try {

    await db.collection("rooms")
      .doc(currentRoom)
      .collection("messages")
      .doc(messageId)
      .delete();


    await logAction(
      "DELETE",

      msg.text ||
      (
        msg.imageName
          ? `[Image: ${msg.imageName}]`
          : ""
      ),

      "",

      messageId
    );


  } catch (error) {

    console.error(error);

    showToast(
      "Could not delete message.",
      "error"
    );

  }

}


// ==========================================
// TYPING
// ==========================================

function attachTypingEvents() {

  const input =
    $("message-input");


  input.addEventListener(
    "input",
    () => {

      autoResizeTextarea(input);


      if (
        currentRoom === "audit-logs"
      ) {
        return;
      }


      updateTypingStatus(true);


      clearTimeout(
        typingTimeout
      );


      typingTimeout =
        setTimeout(
          () => {

            updateTypingStatus(false);

          },
          1800
        );

    }
  );

}


async function updateTypingStatus(
  isTyping
) {

  if (
    !currentUserData ||
    !auth.currentUser ||
    currentRoom === "audit-logs"
  ) {
    return;
  }


  try {

    await db.collection("rooms")
      .doc(currentRoom)
      .collection("typing")
      .doc(auth.currentUser.uid)
      .set({

        uid:
          auth.currentUser.uid,

        name:
          currentUserData.name,

        typing:
          isTyping,

        timestamp:
          firebase.firestore
            .FieldValue
            .serverTimestamp()

      }, {
        merge: true
      });

  } catch (_) {}

}


function listenTypingStatus(room) {

  stopListener("typing");


  listeners.typing =
    db.collection("rooms")
      .doc(room)
      .collection("typing")
      .onSnapshot(snapshot => {

        const names = [];


        snapshot.forEach(doc => {

          const data =
            doc.data();

          if (
            data.typing &&
            data.uid !==
              auth.currentUser?.uid
          ) {

            names.push(
              data.name || "Someone"
            );

          }

        });


        $("typing-indicator").textContent =
          names.length
            ? `${names.join(", ")} ${
                names.length === 1
                  ? "is"
                  : "are"
              } typing...`
            : "";

      });

}


// ==========================================
// ANNOUNCEMENTS
// ==========================================

function startAnnouncementBackgroundListener() {

  stopListener(
    "announcementsBackground"
  );

  announcementInitialized = false;


  listeners.announcementsBackground =
    db.collection("announcements")
      .orderBy("timestamp", "desc")
      .onSnapshot(snapshot => {

        if (!announcementInitialized) {

          announcementInitialized = true;

          return;
        }


        snapshot.docChanges().forEach(
          change => {

            if (
              change.type === "added" &&
              change.doc.data().uid !==
                auth.currentUser?.uid
            ) {

              unreadAnnouncementsCount++;

              updateAnnouncementBadge();

              showToast(
                "New announcement available.",
                "success"
              );

              playUiSound("announcement");
              showAnnouncementNotification(change.doc.data());

            }

          }
        );

      });

}


function updateAnnouncementBadge() {

  const badge =
    $("announcement-badge");


  badge.hidden =
    unreadAnnouncementsCount === 0;


  badge.textContent =
    unreadAnnouncementsCount > 99
      ? "99+"
      : unreadAnnouncementsCount;

}


function openAnnouncements() {

  requestNotificationPermission();

  unreadAnnouncementsCount = 0;

  updateAnnouncementBadge();

  $("clear-announcements-btn").hidden = !isOwner();

  openModal(
    "announcement-modal"
  );

  loadAnnouncements();

}


function loadAnnouncements() {

  stopListener(
    "announcementsList"
  );


  const list =
    $("announcement-list");

  list.replaceChildren();


  listeners.announcementsList =
    db.collection("announcements")
      .orderBy("timestamp", "desc")
      .onSnapshot(snapshot => {

        list.replaceChildren();


        if (snapshot.empty) {

          const empty =
            document.createElement("p");

          empty.style.color =
            "var(--muted)";

          empty.textContent =
            "No announcements yet.";

          list.appendChild(empty);

          return;
        }


        snapshot.forEach(doc => {

          list.appendChild(
            createAnnouncementCard(doc.data(), doc.id)
          );

        });

      });

}


function createAnnouncementCard(data, announcementId) {

  const card =
    document.createElement("article");

  card.className =
    "announcement-card";


  const header =
    document.createElement("div");

  header.className =
    "announcement-card-header";


  const author =
    document.createElement("button");

  author.className =
    "announcement-author";

  author.type = "button";

  author.textContent =
    data.author || "Admin";

  author.addEventListener("click", () => openUserProfile(data.uid));


  const time =
    document.createElement("span");

  time.className =
    "announcement-time";

  time.textContent =
    formatTime(data.timestamp);


  const text =
    document.createElement("div");

  text.className =
    "announcement-text";

  appendTextWithLinks(
    text,
    data.text || ""
  );


  header.append(
    author,
    time
  );


  card.append(
    header,
    text
  );

  if (isOwner()) {
    const remove = createIconButton(
      "fa-solid fa-trash",
      "Delete announcement",
      "delete"
    );
    remove.classList.add("announcement-delete");
    remove.addEventListener("click", () => deleteAnnouncement(announcementId));
    card.appendChild(remove);
  }


  return card;

}


async function postAnnouncement() {

  if (!isAdmin()) {

    showToast(
      "You do not have permission.",
      "error"
    );

    return;
  }


  const input =
    $("announcement-text");

  const text =
    input.value.trim();


  if (!text) return;


  try {

    await db.collection(
      "announcements"
    ).add({

      uid:
        auth.currentUser.uid,

      author:
        currentUserData.name,

      text,

      timestamp:
        firebase.firestore
          .FieldValue
          .serverTimestamp()

    });


    input.value = "";
    playUiSound("success");


  } catch (error) {

    console.error(error);

    showToast(
      "Could not post announcement.",
      "error"
    );

  }

}


// ==========================================
// USER PROFILE
// ==========================================

async function openUserProfile(uid) {

  if (!uid) return;

  showLoading(true);


  try {

    const snapshot =
      await db.collection("users")
        .doc(uid)
        .get();


    if (!snapshot.exists) {

      showToast(
        "User profile not found.",
        "error"
      );

      return;
    }


    const user =
      snapshot.data();


    $("profile-name").textContent =
      user.name || "User";


    const roles =
      $("profile-roles-container");

    roles.replaceChildren();


    (
      user.roles || DEFAULT_ROLES
    ).forEach(role => {

      const badge =
        document.createElement("span");

      badge.className =
        "role-badge";

      badge.textContent =
        role;

      roles.appendChild(badge);

    });


    openModal(
      "profile-modal"
    );


  } catch (error) {

    console.error(error);

    showToast(
      "Could not load profile.",
      "error"
    );

  } finally {

    showLoading(false);

  }

}


// ==========================================
// ROLE MANAGEMENT
// ==========================================

function openChannelManager() {
  if (!isOwner()) {
    showToast("Only the owner can manage channels.", "error");
    return;
  }

  renderChannelManager();
  openModal("channel-modal");
}

async function deleteAnnouncement(announcementId) {
  if (!isOwner() || !announcementId) return;

  if (!confirm("Delete this announcement?")) return;

  try {
    await db.collection("announcements").doc(announcementId).delete();
    playUiSound("danger");
    showToast("Announcement deleted.");
  } catch (error) {
    console.error(error);
    showToast("Could not delete the announcement.", "error");
  }
}

async function deleteAllAnnouncements() {
  if (!isOwner()) return;

  if (!confirm("Delete every announcement? This cannot be undone.")) return;

  showLoading(true);
  try {
    let deleted = 0;

    while (true) {
      const snapshot = await db.collection("announcements").limit(400).get();
      if (snapshot.empty) break;

      const batch = db.batch();
      snapshot.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      deleted += snapshot.size;
    }

    playUiSound("danger");
    showToast(`Deleted ${deleted} announcement${deleted === 1 ? "" : "s"}.`);
  } catch (error) {
    console.error(error);
    showToast("Could not delete all announcements.", "error");
  } finally {
    showLoading(false);
  }
}

function renderChannelManager() {
  const list = $("channel-manager-list");
  if (!list) return;

  list.replaceChildren();

  const channels = [
    ...BUILT_IN_CHANNELS.map(id => channelRules[id] || { id, name: id }),
    ...Object.values(channelRules).filter(channel => !BUILT_IN_CHANNELS.includes(channel.id))
  ];

  channels.forEach(channel => {
    const row = document.createElement("div");
    row.className = "channel-manager-row";

    const details = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = `# ${channel.name || channel.id}`;
    const hint = document.createElement("small");
    hint.textContent = channel.allowedRoles?.length
      ? `Posting: ${channel.allowedRoles.join(", ")}`
      : "Posting: everyone";
    details.append(name, hint);

    const rolesInput = document.createElement("input");
    rolesInput.type = "text";
    rolesInput.maxLength = 200;
    rolesInput.value = (channel.allowedRoles || []).join(", ");
    rolesInput.placeholder = "Everyone can post";
    rolesInput.setAttribute("aria-label", `Roles allowed to post in ${channel.name || channel.id}`);

    const save = document.createElement("button");
    save.type = "button";
    save.className = "btn-secondary channel-row-button";
    save.textContent = "Save access";
    save.addEventListener("click", async () => {
      await db.collection("channels").doc(channel.id).set({
        name: channel.name || channel.id,
        allowedRoles: normalizeRoles(rolesInput.value),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      showToast(`Access saved for #${channel.name || channel.id}.`);
    });

    row.append(details, rolesInput, save);

    if (!BUILT_IN_CHANNELS.includes(channel.id)) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "icon-btn danger";
      remove.title = "Delete channel";
      remove.setAttribute("aria-label", `Delete ${channel.name || channel.id}`);
      remove.innerHTML = '<i class="fa-solid fa-trash"></i>';
      remove.addEventListener("click", () => deleteChannel(channel));
      row.appendChild(remove);
    }

    list.appendChild(row);
  });
}

async function createChannel() {
  if (!isOwner()) return;

  const name = $("new-channel-name").value.trim();
  const id = name.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!id) {
    showToast("Enter a channel name using letters or numbers.", "error");
    return;
  }

  if (BUILT_IN_CHANNELS.includes(id) || channelRules[id]) {
    showToast("That channel already exists.", "error");
    return;
  }

  try {
    await db.collection("channels").doc(id).set({
      name: id,
      allowedRoles: normalizeRoles($("new-channel-roles").value),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdBy: auth.currentUser.uid
    });
    $("new-channel-name").value = "";
    $("new-channel-roles").value = "";
    showToast(`Created #${id}.`);
  } catch (error) {
    console.error(error);
    showToast("Could not create the channel.", "error");
  }
}

async function deleteAllMessages(room) {
  let deleted = 0;

  while (true) {
    const snapshot = await db.collection("rooms").doc(room)
      .collection("messages").limit(400).get();

    if (snapshot.empty) return deleted;

    const batch = db.batch();
    snapshot.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    deleted += snapshot.size;
  }
}

async function clearCurrentChannel() {
  if (!isOwner()) return;

  if (!confirm(`Delete every message in #${currentRoom}? This cannot be undone.`)) {
    return;
  }

  showLoading(true);
  try {
    const count = await deleteAllMessages(currentRoom);
    showToast(`Deleted ${count} message${count === 1 ? "" : "s"}.`);
  } catch (error) {
    console.error(error);
    showToast("Could not delete all messages. Check Firestore rules.", "error");
  } finally {
    showLoading(false);
  }
}

async function deleteChannel(channel) {
  if (!isOwner()) return;

  if (!confirm(`Delete #${channel.name || channel.id} and all of its messages? This cannot be undone.`)) {
    return;
  }

  showLoading(true);
  try {
    await deleteAllMessages(channel.id);
    await db.collection("channels").doc(channel.id).delete();
    if (currentRoom === channel.id) switchRoom("general", true);
    showToast(`Deleted #${channel.name || channel.id}.`);
  } catch (error) {
    console.error(error);
    showToast("Could not delete the channel. Check Firestore rules.", "error");
  } finally {
    showLoading(false);
  }
}

async function openRoleModal() {

  if (!isOwner()) {

    showToast(
      "Only the owner can manage roles.",
      "error"
    );

    return;
  }


  showLoading(true);


  try {

    const users =
      await db.collection("users")
        .orderBy("name")
        .get();


    const select =
      $("user-select-dropdown");

    select.replaceChildren();


    users.forEach(doc => {

      const data =
        doc.data();


      const option =
        document.createElement("option");


      option.value =
        doc.id;


      option.textContent =
        `${data.name || "User"} (${
          (
            data.roles ||
            DEFAULT_ROLES
          ).join(", ")
        })`;


      select.appendChild(option);

    });


    if (select.value) {

      await populateSelectedUserRoles();

    }


    openModal(
      "role-modal"
    );


  } catch (error) {

    console.error(error);

    showToast(
      "Could not load users.",
      "error"
    );

  } finally {

    showLoading(false);

  }

}


async function populateSelectedUserRoles() {

  const uid =
    $("user-select-dropdown").value;

  if (!uid) return;


  const snapshot =
    await db.collection("users")
      .doc(uid)
      .get();


  if (snapshot.exists) {

    $("custom-role-input").value =
      (
        snapshot.data().roles ||
        DEFAULT_ROLES
      ).join(", ");

  }

}


async function saveTargetUserRoles() {

  if (!isOwner()) return;


  const uid =
    $("user-select-dropdown").value;

  const raw =
    $("custom-role-input")
      .value
      .trim();


  if (!uid || !raw) {

    showToast(
      "Enter at least one role.",
      "error"
    );

    return;
  }


  const roles =
    [
      ...new Set(
        raw
          .split(",")
          .map(role =>
            role.trim().toUpperCase()
          )
          .filter(Boolean)
      )
    ];


  try {

    await db.collection("users")
      .doc(uid)
      .update({
        roles
      });


    if (
      uid === auth.currentUser?.uid
    ) {

      currentUserData.roles =
        roles;

      updateCurrentUserUI();

    }


    closeModal(
      "role-modal"
    );


    showToast(
      "Roles updated."
    );


  } catch (error) {

    console.error(error);

    showToast(
      "Could not update roles.",
      "error"
    );

  }

}


// ==========================================
// AUDIT LOGS
// ==========================================

async function logAction(
  action,
  originalText,
  newText = "",
  messageId = ""
) {

  try {

    await db.collection("audit_logs")
      .add({

        action,

        actorUid:
          auth.currentUser?.uid || null,

        author:
          currentUserData?.name || "Unknown",

        room:
          currentRoom,

        messageId,

        originalText,

        newText,

        timestamp:
          firebase.firestore
            .FieldValue
            .serverTimestamp()

      });

  } catch (error) {

    console.warn(
      "Audit log failed:",
      error
    );

  }

}


function loadAuditLogs() {

  if (!isAdmin()) {

    showToast(
      "You do not have permission.",
      "error"
    );

    return;
  }


  stopListener("messages");

  stopListener("typing");


  currentRoom =
    "audit-logs";


  document
    .querySelectorAll(
      ".nav-btn[data-room]"
    )
    .forEach(button => {

      button.classList.remove("active");

    });


  const title =
    $("current-room-title");

  title.replaceChildren();


  const icon =
    document.createElement("i");

  icon.className =
    "fa-solid fa-shield-halved";


  title.append(
    icon,
    document.createTextNode(
      " Audit Logs"
    )
  );


  $("typing-indicator").textContent =
    "";


  const container =
    $("message-container");

  container.replaceChildren();


  listeners.messages =
    db.collection("audit_logs")
      .orderBy("timestamp", "desc")
      .limit(200)
      .onSnapshot(
        snapshot => {

          container.replaceChildren();


          snapshot.forEach(doc => {

            const log =
              doc.data();


            const item =
              document.createElement("article");

            item.className =
              "message";


            const header =
              document.createElement("div");

            header.className =
              "message-header";


            const author =
              document.createElement("strong");

            author.textContent =
              `[${log.action || "ACTION"}] ${
                log.author || "Unknown"
              }`;


            const time =
              document.createElement("span");

            time.className =
              "msg-time";

            time.textContent =
              `${log.room || "unknown"} • ${
                formatTime(
                  log.timestamp
                )
              }`;


            const body =
              document.createElement("div");

            body.className =
              "msg-text";


            if (
              log.action === "EDIT"
            ) {

              body.textContent =
                `Original: ${
                  log.originalText || ""
                }\nUpdated to: ${
                  log.newText || ""
                }`;

            } else {

              body.textContent =
                `Deleted: ${
                  log.originalText || ""
                }`;

            }


            header.append(
              author,
              time
            );


            item.append(
              header,
              body
            );


            container.appendChild(item);

          });

        },

        error => {

          console.error(error);

          showToast(
            "Could not load audit logs.",
            "error"
          );

        }
      );


  closeSidebar();

}


// ==========================================
// MODALS
// ==========================================

function openModal(id) {

  const modal = $(id);

  if (!modal) return;

  modal.hidden = false;

  const closeButton = modal.querySelector(".close-modal");

  if (closeButton) {
    closeButton.focus();
  }

}


function closeModal(id) {

  const modal = $(id);

  if (!modal) return;

  modal.hidden = true;


  if (
    id === "announcement-modal"
  ) {

    stopListener(
      "announcementsList"
    );

  }

}


// ==========================================
// IMAGE LIGHTBOX
// ==========================================

function openLightbox(src) {

  $("lightbox-img").src =
    src;

  $("image-lightbox-modal").hidden =
    false;

}


function closeLightbox() {

  $("image-lightbox-modal").hidden =
    true;

  $("lightbox-img")
    .removeAttribute("src");

}


// ==========================================
// MOBILE SIDEBAR
// ==========================================

function openSidebar() {

  $("sidebar").classList.add("open");

  $("sidebar-overlay")
    .classList.add("open");

}


function closeSidebar() {

  $("sidebar").classList.remove("open");

  $("sidebar-overlay")
    .classList.remove("open");

}


// ==========================================
// EVENTS
// ==========================================

$("sign-in-btn")
  .addEventListener(
    "click",
    signIn
  );

$("register-btn")
  .addEventListener(
    "click",
    register
  );

$("logout-btn")
  .addEventListener(
    "click",
    logout
  );


$("email-input")
  .addEventListener(
    "keydown",
    event => {

      if (event.key === "Enter") {
        signIn();
      }

    }
  );


$("password-input")
  .addEventListener(
    "keydown",
    event => {

      if (event.key === "Enter") {
        signIn();
      }

    }
  );


document
  .querySelectorAll(
    ".nav-btn[data-room]"
  )
  .forEach(button => {

    button.addEventListener(
      "click",
      () => {

        switchRoom(
          button.dataset.room
        );

      }
    );

  });


$("roles-btn")
  .addEventListener(
    "click",
    openRoleModal
  );


$("audit-btn")
  .addEventListener(
    "click",
    loadAuditLogs
  );


$("profile-btn")
  .addEventListener(
    "click",
    () => {

      openUserProfile(
        auth.currentUser?.uid
      );

    }
  );


$("announcement-btn")
  .addEventListener(
    "click",
    openAnnouncements
  );


$("post-announcement-btn")
  .addEventListener(
    "click",
    postAnnouncement
  );


$("save-roles-btn")
  .addEventListener(
    "click",
    saveTargetUserRoles
  );


$("user-select-dropdown")
  .addEventListener(
    "change",
    populateSelectedUserRoles
  );


$("message-form")
  .addEventListener(
    "submit",
    event => {

      event.preventDefault();

      sendMessage();

    }
  );


$("clear-announcements-btn")
  .addEventListener(
    "click",
    deleteAllAnnouncements
  );


$("channel-manager-btn")
  .addEventListener(
    "click",
    openChannelManager
  );


$("create-channel-btn")
  .addEventListener(
    "click",
    createChannel
  );


$("clear-current-channel-btn")
  .addEventListener(
    "click",
    clearCurrentChannel
  );


$("message-input")
  .addEventListener(
    "keydown",
    event => {

      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.isComposing
      ) {
        event.preventDefault();
        sendMessage();
      }

    }
  );


$("file-upload")
  .addEventListener(
    "change",
    event => {

      uploadSelectedImage(
        event.target.files[0]
      );

    }
  );


$("save-edit-btn")
  .addEventListener(
    "click",
    saveEditedMessage
  );


$("cancel-edit-btn")
  .addEventListener(
    "click",
    () => {

      closeModal(
        "edit-modal"
      );

    }
  );


document
  .querySelectorAll(".close-modal")
  .forEach(button => {

    button.addEventListener(
      "click",
      () => {

        closeModal(
          button.dataset.close
        );

      }
    );

  });


document
  .querySelectorAll(".modal")
  .forEach(modal => {

    modal.addEventListener(
      "click",
      event => {

        if (event.target === modal) {

          closeModal(modal.id);

        }

      }
    );

  });


$("close-lightbox-btn")
  .addEventListener(
    "click",
    closeLightbox
  );


$("image-lightbox-modal")
  .addEventListener(
    "click",
    event => {

      if (
        event.target ===
        $("image-lightbox-modal")
      ) {

        closeLightbox();

      }

    }
  );


$("menu-btn")
  .addEventListener(
    "click",
    openSidebar
  );


$("close-sidebar-btn")
  .addEventListener(
    "click",
    closeSidebar
  );


$("sidebar-overlay")
  .addEventListener(
    "click",
    closeSidebar
  );


document.addEventListener(
  "keydown",
  event => {

    if (event.key === "Escape") {

      document
        .querySelectorAll(
          ".modal:not([hidden])"
        )
        .forEach(modal => {

          closeModal(modal.id);

        });


      closeLightbox();

      closeSidebar();

    }

  }
);


document.addEventListener("click", event => {
  if (
    event.target.closest("button") &&
    !event.target.closest("#send-btn")
  ) {
    playUiSound("click");
  }
});


attachTypingEvents();
