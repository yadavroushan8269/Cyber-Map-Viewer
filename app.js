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


/* =========================
   FIREBASE
========================= */

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);


/* =========================
   GLOBAL VARIABLES
========================= */

const $ = (id) => document.getElementById(id);

let currentUser = null;
let profile = null;


/* =========================
   ROOM ID
========================= */

function makeRoomId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  let room = "";

  for (let i = 0; i < 8; i++) {
    room += chars[Math.floor(Math.random() * chars.length)];
  }

  return room;
}


/* =========================
   LOGIN
========================= */

async function login() {

  const nameInput = $("nameInput");

  if (!nameInput) {
    console.error("nameInput not found");
    return;
  }

  const name = nameInput.value.trim();

  if (!name) {

    if ($("authMsg")) {
      $("authMsg").textContent = "Enter your name.";
    }

    return;
  }

  if ($("authMsg")) {
    $("authMsg").textContent = "Connecting...";
  }

  try {

    sessionStorage.setItem("pendingName", name);

    await signInAnonymously(auth);

  } catch (error) {

    console.error("LOGIN ERROR:", error);

    if ($("authMsg")) {
      $("authMsg").textContent =
        "Firebase login failed: " + error.message;
    }

  }
}


/* =========================
   AUTH STATE
========================= */

onAuthStateChanged(auth, async (user) => {

  if (!user) {
    return;
  }

  console.log("Firebase user:", user.uid);

  currentUser = user;

  try {

    const userRef = doc(db, "users", user.uid);

    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {

      let room = makeRoomId();

      let collision = await getDocs(
        query(
          collection(db, "users"),
          where("roomId", "==", room)
        )
      );

      while (!collision.empty) {

        room = makeRoomId();

        collision = await getDocs(
          query(
            collection(db, "users"),
            where("roomId", "==", room)
          )
        );

      }

      const savedName =
        sessionStorage.getItem("pendingName") || "User";

      profile = {
        name: savedName,
        roomId: room,
        createdAt: serverTimestamp()
      };

      await setDoc(userRef, profile);

    } else {

      profile = userSnap.data();

    }


    /* =========================
       SHOW APP
    ========================= */

    if ($("authView")) {
      $("authView").hidden = true;
    }

    if ($("appView")) {
      $("appView").hidden = false;
    }

    if ($("welcome")) {
      $("welcome").textContent =
        "Hi, " + (profile.name || "User");
    }

    if ($("roomId")) {
      $("roomId").textContent =
        profile.roomId || "--------";
    }


    /* =========================
       LOAD DATA
    ========================= */

    try {

      await refreshAll();

    } catch (error) {

      console.error("DATA LOAD ERROR:", error);

      showError(
        "Connected successfully, but some data could not be loaded."
      );

    }


  } catch (error) {

    console.error("APP START ERROR:", error);

    if ($("authMsg")) {

      $("authMsg").textContent =
        "Firebase error: " + error.message;

    }

  }

});


/* =========================
   LOGIN BUTTON
========================= */

const loginBtn = $("loginBtn");

if (loginBtn) {
  loginBtn.onclick = login;
}


/* =========================
   LOGOUT
========================= */

const logoutBtn = $("logoutBtn");

if (logoutBtn) {

  logoutBtn.onclick = async () => {

    try {

      await signOut(auth);

      sessionStorage.removeItem("pendingName");

      location.reload();

    } catch (error) {

      console.error("LOGOUT ERROR:", error);

    }

  };

}


/* =========================
   COPY ROOM ID
========================= */

const copyRoomBtn = $("copyRoomBtn");

if (copyRoomBtn) {

  copyRoomBtn.onclick = async () => {

    if (!profile) return;

    try {

      await navigator.clipboard.writeText(profile.roomId);

      if ($("requestMsg")) {
        $("requestMsg").textContent =
          "Room ID copied.";
      }

    } catch (error) {

      console.error(error);

    }

  };

}


/* =========================
   SEND FRIEND REQUEST
========================= */

const sendRequestBtn = $("sendRequestBtn");

if (sendRequestBtn) {

  sendRequestBtn.onclick = async () => {

    if (!currentUser || !profile) return;

    const input = $("friendRoomInput");

    const room =
      input.value.trim().toUpperCase();

    if (!room) {

      $("requestMsg").textContent =
        "Enter a Room ID.";

      return;

    }

    if (room === profile.roomId) {

      $("requestMsg").textContent =
        "You cannot add yourself.";

      return;

    }

    try {

      const q = await getDocs(
        query(
          collection(db, "users"),
          where("roomId", "==", room)
        )
      );

      if (q.empty) {

        $("requestMsg").textContent =
          "User not found.";

        return;

      }

      const target = q.docs[0];

      const existing = await getDocs(
        query(
          collection(db, "requests"),
          where("fromUid", "==", currentUser.uid),
          where("toUid", "==", target.id),
          where("status", "==", "pending")
        )
      );

      if (!existing.empty) {

        $("requestMsg").textContent =
          "Request already sent.";

        return;

      }

      await addDoc(
        collection(db, "requests"),
        {
          fromUid: currentUser.uid,
          fromName: profile.name,
          fromRoomId: profile.roomId,

          toUid: target.id,

          status: "pending",

          createdAt: serverTimestamp()
        }
      );

      $("requestMsg").textContent =
        "Request sent.";

      input.value = "";

    } catch (error) {

      console.error("REQUEST ERROR:", error);

      $("requestMsg").textContent =
        "Could not send request.";

    }

  };

}


/* =========================
   REQUESTS
========================= */

async function renderRequests() {

  const box = $("requests");

  if (!box) return;

  try {

    const q = await getDocs(
      query(
        collection(db, "requests"),
        where("toUid", "==", currentUser.uid),
        where("status", "==", "pending")
      )
    );

    box.innerHTML = "";

    if (q.empty) {

      box.innerHTML =
        '<div class="empty">No pending requests.</div>';

      return;

    }

    q.forEach((d) => {

      const x = d.data();

      const el = document.createElement("div");

      el.className = "item";

      el.innerHTML = `
        <b>${escapeHtml(x.fromName || "User")}</b>
        <br>
        <small>
          Room ID: ${escapeHtml(x.fromRoomId || "")}
        </small>

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

      box.appendChild(el);

    });


    document
      .querySelectorAll("[data-accept]")
      .forEach((button) => {

        button.onclick = () =>
          respond(
            button.dataset.accept,
            "accepted"
          );

      });


    document
      .querySelectorAll("[data-reject]")
      .forEach((button) => {

        button.onclick = () =>
          respond(
            button.dataset.reject,
            "rejected"
          );

      });


  } catch (error) {

    console.error(
      "REQUESTS LOAD ERROR:",
      error
    );

    box.innerHTML =
      '<div class="empty">Unable to load requests.</div>';

  }

}


/* =========================
   ACCEPT / REJECT
========================= */

async function respond(id, status) {

  try {

    const ref = doc(db, "requests", id);

    const snap = await getDoc(ref);

    if (!snap.exists()) {
      return;
    }

    const r = snap.data();


    await updateDoc(ref, {
      status: status
    });


    if (status === "accepted") {

      const users = [
        r.fromUid,
        currentUser.uid
      ].sort();

      const friendshipId =
        users[0] + "_" + users[1];


      await setDoc(
        doc(
          db,
          "friendships",
          friendshipId
        ),
        {
          users: users,
          createdAt: serverTimestamp()
        }
      );

    }


    await refreshAll();


  } catch (error) {

    console.error(
      "RESPONSE ERROR:",
      error
    );

  }

}


/* =========================
   FRIENDS
========================= */

async function renderFriends() {

  const box = $("friends");

  if (!box) return;

  try {

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


    box.innerHTML = "";


    if (q.empty) {

      box.innerHTML =
        '<div class="empty">No friends yet.</div>';

      return;

    }


    for (const d of q.docs) {

      const data = d.data();

      const ids = data.users || [];

      const other =
        ids.find(
          (id) => id !== currentUser.uid
        );


      if (!other) continue;


      const userSnap =
        await getDoc(
          doc(db, "users", other)
        );


      if (!userSnap.exists()) continue;


      const x = userSnap.data();


      const el =
        document.createElement("div");


      el.className = "item";


      el.innerHTML = `
        <b>${escapeHtml(x.name || "User")}</b>
        <br>

        <small>
          Room ID: ${escapeHtml(x.roomId || "")}
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


      box.appendChild(el);

    }


  } catch (error) {

    console.error(
      "FRIENDS LOAD ERROR:",
      error
    );

    box.innerHTML =
      '<div class="empty">Unable to load friends.</div>';

  }

}


/* =========================
   POST STORY
========================= */

const postStoryBtn = $("postStoryBtn");

if (postStoryBtn) {

  postStoryBtn.onclick = async () => {

    if (!currentUser || !profile) return;

    const text =
      $("storyText").value.trim();


    if (!text) return;


    try {

      await addDoc(
        collection(db, "stories"),
        {
          uid: currentUser.uid,
          name: profile.name,
          text: text,

          createdAt: serverTimestamp(),

          expiresAt:
            Date.now() + 86400000
        }
      );


      $("storyText").value = "";


      await renderStories();


    } catch (error) {

      console.error(
        "STORY ERROR:",
        error
      );

    }

  };

}


/* =========================
   STORIES
========================= */

async function renderStories() {

  const box = $("stories");

  if (!box) return;


  try {

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


    box.innerHTML = "";


    if (q.empty) {

      box.innerHTML =
        '<div class="empty">No stories yet.</div>';

      return;

    }


    for (const d of q.docs) {

      const x = d.data();


      if (
        x.expiresAt &&
        x.expiresAt <= now
      ) {

        try {
          await deleteDoc(d.ref);
        } catch (e) {
          console.error(e);
        }

        continue;

      }


      const el =
        document.createElement("div");


      el.className =
        "item story";


      const hours =
        x.expiresAt
          ? Math.ceil(
              (x.expiresAt - now)
              / 3600000
            )
          : 24;


      el.innerHTML = `
        <b>
          ${escapeHtml(x.name || "User")}
        </b>

        <p>
          ${escapeHtml(x.text || "")}
        </p>

        <small>
          Expires in about ${hours}h
        </small>
      `;


      box.appendChild(el);

    }


  } catch (error) {

    console.error(
      "STORIES LOAD ERROR:",
      error
    );

    box.innerHTML =
      '<div class="empty">Unable to load stories.</div>';

  }

}


/* =========================
   REFRESH ALL
========================= */

async function refreshAll() {

  await renderRequests();

  await renderFriends();

  await renderStories();

}


/* =========================
   ERROR MESSAGE
========================= */

function showError(message) {

  console.warn(message);

  if ($("authMsg")) {
    $("authMsg").textContent = message;
  }

}


/* =========================
   HTML ESCAPE
========================= */

function escapeHtml(value) {

  return String(value || "").replace(
    /[&<>"']/g,
    (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[c])
  );

}
