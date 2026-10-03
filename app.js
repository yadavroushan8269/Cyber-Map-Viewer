import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";

import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";

import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = id => document.getElementById(id);

let currentUser = null;
let profile = null;

function showError(error) {
  console.error(error);

  const code = error?.code || "unknown";
  const message = error?.message || String(error);

  const box = $("authMsg");

  if (box) {
    box.style.whiteSpace = "pre-wrap";
    box.style.color = "red";
    box.textContent =
      "ERROR\n\n" +
      "Code: " + code + "\n\n" +
      message;
  }
}

function makeRoomId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  let result = "";

  for (let i = 0; i < 8; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }

  return result;
}

async function login() {
  const nameInput = $("nameInput");

  const name = nameInput.value.trim();

  if (!name) {
    $("authMsg").textContent = "Enter your name.";
    return;
  }

  $("authMsg").style.color = "";
  $("authMsg").textContent = "Connecting...";

  try {
    sessionStorage.setItem("pendingName", name);

    await signInAnonymously(auth);

  } catch (error) {
    showError(error);
  }
}

$("loginBtn").onclick = login;

$("logoutBtn").onclick = async () => {
  try {
    await signOut(auth);
    location.reload();
  } catch (error) {
    showError(error);
  }
};

onAuthStateChanged(auth, async user => {

  if (!user) {
    return;
  }

  currentUser = user;

  try {

    $("authMsg").textContent = "Firebase connected.\nLoading profile...";

    const userRef = doc(db, "users", user.uid);

    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {

      let roomId = makeRoomId();

      let roomQuery = await getDocs(
        query(
          collection(db, "users"),
          where("roomId", "==", roomId)
        )
      );

      while (!roomQuery.empty) {

        roomId = makeRoomId();

        roomQuery = await getDocs(
          query(
            collection(db, "users"),
            where("roomId", "==", roomId)
          )
        );
      }

      profile = {
        name: sessionStorage.getItem("pendingName") || "User",
        roomId: roomId,
        createdAt: serverTimestamp()
      };

      await setDoc(userRef, profile);

    } else {

      profile = userSnap.data();

    }

    $("authView").hidden = true;
    $("appView").hidden = false;

    $("welcome").textContent = "Hi, " + profile.name;

    $("roomId").textContent = profile.roomId;

    await refreshAll();

  } catch (error) {

    showError(error);

  }

});


$("copyRoomBtn").onclick = async () => {

  try {

    await navigator.clipboard.writeText(profile.roomId);

    $("requestMsg").textContent = "Room ID copied.";

  } catch (error) {

    showError(error);

  }

};


$("sendRequestBtn").onclick = async () => {

  try {

    const room = $("friendRoomInput")
      .value
      .trim()
      .toUpperCase();

    if (!room) {
      $("requestMsg").textContent = "Enter a Room ID.";
      return;
    }

    if (room === profile.roomId) {
      $("requestMsg").textContent = "You cannot add yourself.";
      return;
    }

    const usersQuery = await getDocs(
      query(
        collection(db, "users"),
        where("roomId", "==", room)
      )
    );

    if (usersQuery.empty) {
      $("requestMsg").textContent = "User not found.";
      return;
    }

    const target = usersQuery.docs[0];

    const existing = await getDocs(
      query(
        collection(db, "requests"),
        where("fromUid", "==", currentUser.uid),
        where("toUid", "==", target.id),
        where("status", "==", "pending")
      )
    );

    if (!existing.empty) {
      $("requestMsg").textContent = "Request already sent.";
      return;
    }

    await addDoc(collection(db, "requests"), {

      fromUid: currentUser.uid,
      fromName: profile.name,
      fromRoomId: profile.roomId,

      toUid: target.id,

      status: "pending",

      createdAt: serverTimestamp()

    });

    $("requestMsg").textContent = "Request sent.";

    $("friendRoomInput").value = "";

  } catch (error) {

    $("requestMsg").textContent =
      "ERROR: " + (error.code || "") + " " + error.message;

  }

};


async function renderRequests() {

  const q = await getDocs(
    query(
      collection(db, "requests"),
      where("toUid", "==", currentUser.uid),
      where("status", "==", "pending")
    )
  );

  $("requests").innerHTML = "";

  if (q.empty) {

    $("requests").innerHTML =
      '<div class="empty">No pending requests.</div>';

    return;
  }

  q.forEach(d => {

    const x = d.data();

    const el = document.createElement("div");

    el.className = "item";

    el.innerHTML = `
      <b>${escapeHtml(x.fromName)}</b>
      <br>
      <small>Room ID: ${escapeHtml(x.fromRoomId)}</small>

      <div class="actions">

        <button data-accept="${d.id}">
          Accept
        </button>

        <button
          class="secondary"
          data-reject="${d.id}">
          Reject
        </button>

      </div>
    `;

    $("requests").appendChild(el);

  });

  document
    .querySelectorAll("[data-accept]")
    .forEach(button => {

      button.onclick = () =>
        respond(
          button.dataset.accept,
          "accepted"
        );

    });

  document
    .querySelectorAll("[data-reject]")
    .forEach(button => {

      button.onclick = () =>
        respond(
          button.dataset.reject,
          "rejected"
        );

    });

}


async function respond(id, status) {

  try {

    const requestRef =
      doc(db, "requests", id);

    const snap =
      await getDoc(requestRef);

    if (!snap.exists()) {
      return;
    }

    const requestData = snap.data();

    await updateDoc(
      requestRef,
      { status }
    );

    if (status === "accepted") {

      await setDoc(
        doc(
          db,
          "friendships",
          requestData.fromUid +
          "_" +
          currentUser.uid
        ),
        {
          users: [
            requestData.fromUid,
            currentUser.uid
          ],

          createdAt: serverTimestamp()
        }
      );

    }

    await refreshAll();

  } catch (error) {

    alert(
      "ERROR: " +
      (error.code || "") +
      "\n\n" +
      error.message
    );

  }

}


async function renderFriends() {

  const q = await getDocs(
    query(
      collection(db, "friendships"),
      where(
        "users",
        "array-contains",
        currentUser.uid
      )
    )
  );

  $("friends").innerHTML = "";

  if (q.empty) {

    $("friends").innerHTML =
      '<div class="empty">No friends yet.</div>';

    return;
  }

  for (const d of q.docs) {

    const ids = d.data().users;

    const other =
      ids.find(
        uid => uid !== currentUser.uid
      );

    if (!other) continue;

    const snap =
      await getDoc(
        doc(db, "users", other)
      );

    if (!snap.exists()) continue;

    const x = snap.data();

    const el =
      document.createElement("div");

    el.className = "item";

    el.innerHTML = `
      <b>${escapeHtml(x.name)}</b>
      <br>
      <small>
        Room ID: ${escapeHtml(x.roomId)}
      </small>

      <div class="actions">

        <button disabled>
          Video call
        </button>

        <button
          class="secondary"
          disabled>
          Chat
        </button>

      </div>
    `;

    $("friends").appendChild(el);
  }

}


$("postStoryBtn").onclick = async () => {

  try {

    const text =
      $("storyText").value.trim();

    if (!text) return;

    await addDoc(
      collection(db, "stories"),
      {
        uid: currentUser.uid,
        name: profile.name,
        text: text,
        createdAt: serverTimestamp(),
        expiresAt: Date.now() + 86400000
      }
    );

    $("storyText").value = "";

    await renderStories();

  } catch (error) {

    alert(
      "ERROR: " +
      (error.code || "") +
      "\n\n" +
      error.message
    );

  }

};


async function renderStories() {

  const now = Date.now();

  const q = await getDocs(
    query(
      collection(db, "stories"),
      where(
        "uid",
        "==",
        currentUser.uid
      )
    )
  );

  $("stories").innerHTML = "";

  for (const d of q.docs) {

    const x = d.data();

    if (x.expiresAt <= now) {

      await deleteDoc(d.ref);

      continue;
    }

    const el =
      document.createElement("div");

    el.className = "item story";

    el.innerHTML = `
      <b>${escapeHtml(x.name)}</b>

      <p>
        ${escapeHtml(x.text)}
      </p>

      <small>
        Expires in about
        ${Math.ceil(
          (x.expiresAt - now) / 3600000
        )}h
      </small>
    `;

    $("stories").appendChild(el);
  }

}


async function refreshAll() {

  try {
    await renderRequests();
  } catch (error) {
    console.error("Requests error:", error);
  }

  try {
    await renderFriends();
  } catch (error) {
    console.error("Friends error:", error);
  }

  try {
    await renderStories();
  } catch (error) {
    console.error("Stories error:", error);
  }

}


function escapeHtml(value) {

  return String(value).replace(
    /[&<>"']/g,
    character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[character])
  );

}
