import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";

import {
  getAuth,
  signInAnonymously,
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


// ======================================================
// FIREBASE
// ======================================================

const app = initializeApp(firebaseConfig);

const auth = getAuth(app);

const db = getFirestore(app);


// ======================================================
// HELPERS
// ======================================================

const $ = id => document.getElementById(id);

let currentUser = null;

let profile = null;


// ======================================================
// ERROR DISPLAY
// ======================================================

function showError(error, location = "Firebase") {

  console.error(location, error);

  const code =
    error?.code ||
    "unknown";

  const message =
    error?.message ||
    String(error);

  const box = $("authMsg");

  if (box) {

    box.style.whiteSpace = "pre-wrap";

    box.style.color = "red";

    box.textContent =
      "ERROR\n\n" +
      "Location: " +
      location +
      "\n\n" +
      "Code: " +
      code +
      "\n\n" +
      message;

  }

}


// ======================================================
// ROOM ID
// ======================================================

function makeRoomId() {

  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  let result = "";

  for (let i = 0; i < 8; i++) {

    result +=
      chars[
        Math.floor(
          Math.random() * chars.length
        )
      ];

  }

  return result;

}


// ======================================================
// CREATE UNIQUE ROOM ID
// ======================================================

async function createUniqueRoomId() {

  let roomId = makeRoomId();

  let roomQuery =
    await getDocs(
      query(
        collection(db, "users"),
        where("roomId", "==", roomId)
      )
    );

  while (!roomQuery.empty) {

    roomId = makeRoomId();

    roomQuery =
      await getDocs(
        query(
          collection(db, "users"),
          where("roomId", "==", roomId)
        )
      );

  }

  return roomId;

}


// ======================================================
// LOGIN
// ======================================================

async function login() {

  const nameInput =
    $("nameInput");

  const name =
    nameInput.value.trim();


  if (!name) {

    $("authMsg").textContent =
      "Enter your name.";

    return;

  }


  $("authMsg").style.color = "";

  $("authMsg").style.whiteSpace =
    "pre-wrap";

  $("authMsg").textContent =
    "Connecting...";


  try {

    // Save name BEFORE Firebase login
    sessionStorage.setItem(
      "pendingName",
      name
    );


    // DIRECT ANONYMOUS LOGIN
    const credential =
      await signInAnonymously(auth);


    // Get Firebase user directly
    currentUser =
      credential.user;


    if (!currentUser) {

      throw new Error(
        "Firebase login completed but user was not returned."
      );

    }


    $("authMsg").textContent =
      "Firebase connected.\nLoading profile...";


    // ==================================================
    // USER PROFILE
    // ==================================================

    const userRef =
      doc(
        db,
        "users",
        currentUser.uid
      );


    const userSnap =
      await getDoc(userRef);


    if (userSnap.exists()) {

      profile =
        userSnap.data();

    } else {

      const newRoomId =
        await createUniqueRoomId();


      profile = {

        name: name,

        roomId: newRoomId,

        createdAt:
          serverTimestamp()

      };


      await setDoc(
        userRef,
        profile
      );

    }


    // ==================================================
    // OPEN MAIN APP
    // ==================================================

    $("authView").hidden =
      true;

    $("appView").hidden =
      false;


    $("welcome").textContent =
      "Hi, " +
      profile.name;


    $("roomId").textContent =
      profile.roomId;


    // Clear login message
    $("authMsg").textContent =
      "";


    // Load app data
    await refreshAll();


  } catch (error) {

    showError(
      error,
      "Login / Profile"
    );

  }

}


// ======================================================
// LOGIN BUTTON
// ======================================================

$("loginBtn").onclick =
  login;


// ======================================================
// LOGOUT
// ======================================================

$("logoutBtn").onclick =
  async () => {

    try {

      await signOut(auth);

      sessionStorage.removeItem(
        "pendingName"
      );

      location.reload();

    } catch (error) {

      showError(
        error,
        "Logout"
      );

    }

  };


// ======================================================
// COPY ROOM ID
// ======================================================

$("copyRoomBtn").onclick =
  async () => {

    try {

      if (!profile?.roomId) {

        throw new Error(
          "Room ID is not available yet."
        );

      }


      await navigator.clipboard.writeText(
        profile.roomId
      );


      $("requestMsg").textContent =
        "Room ID copied.";

    } catch (error) {

      // Fallback for some mobile browsers
      try {

        const textArea =
          document.createElement(
            "textarea"
          );

        textArea.value =
          profile.roomId;

        document.body.appendChild(
          textArea
        );

        textArea.select();

        document.execCommand(
          "copy"
        );

        textArea.remove();


        $("requestMsg").textContent =
          "Room ID copied.";

      } catch (fallbackError) {

        $("requestMsg").textContent =
          "Could not copy Room ID.";

      }

    }

  };


// ======================================================
// SEND FRIEND REQUEST
// ======================================================

$("sendRequestBtn").onclick =
  async () => {

    try {

      if (!currentUser || !profile) {

        throw new Error(
          "Please login first."
        );

      }


      const room =
        $("friendRoomInput")
          .value
          .trim()
          .toUpperCase();


      if (!room) {

        $("requestMsg").textContent =
          "Enter a Room ID.";

        return;

      }


      if (
        room ===
        profile.roomId
      ) {

        $("requestMsg").textContent =
          "You cannot add yourself.";

        return;

      }


      $("requestMsg").textContent =
        "Searching user...";


      const usersQuery =
        await getDocs(
          query(
            collection(db, "users"),
            where(
              "roomId",
              "==",
              room
            )
          )
        );


      if (usersQuery.empty) {

        $("requestMsg").textContent =
          "User not found.";

        return;

      }


      const target =
        usersQuery.docs[0];


      // Check existing pending request
      const existing =
        await getDocs(
          query(
            collection(db, "requests"),

            where(
              "fromUid",
              "==",
              currentUser.uid
            ),

            where(
              "toUid",
              "==",
              target.id
            ),

            where(
              "status",
              "==",
              "pending"
            )
          )
        );


      if (!existing.empty) {

        $("requestMsg").textContent =
          "Request already sent.";

        return;

      }


      // Check reverse pending request
      const reverse =
        await getDocs(
          query(
            collection(db, "requests"),

            where(
              "fromUid",
              "==",
              target.id
            ),

            where(
              "toUid",
              "==",
              currentUser.uid
            ),

            where(
              "status",
              "==",
              "pending"
            )
          )
        );


      if (!reverse.empty) {

        $("requestMsg").textContent =
          "This user already sent you a request.";

        return;

      }


      await addDoc(
        collection(
          db,
          "requests"
        ),
        {

          fromUid:
            currentUser.uid,

          fromName:
            profile.name,

          fromRoomId:
            profile.roomId,

          toUid:
            target.id,

          status:
            "pending",

          createdAt:
            serverTimestamp()

        }
      );


      $("requestMsg").textContent =
        "Request sent.";


      $("friendRoomInput").value =
        "";


      await renderRequests();


    } catch (error) {

      $("requestMsg").style.whiteSpace =
        "pre-wrap";

      $("requestMsg").textContent =
        "ERROR\n" +
        (error.code || "") +
        "\n\n" +
        error.message;

    }

  };


// ======================================================
// RENDER INCOMING REQUESTS
// ======================================================

async function renderRequests() {

  if (!currentUser) return;


  const q =
    await getDocs(
      query(
        collection(
          db,
          "requests"
        ),

        where(
          "toUid",
          "==",
          currentUser.uid
        ),

        where(
          "status",
          "==",
          "pending"
        )
      )
    );


  $("requests").innerHTML =
    "";


  if (q.empty) {

    $("requests").innerHTML =
      '<div class="empty">No pending requests.</div>';

    return;

  }


  q.forEach(
    requestDoc => {

      const data =
        requestDoc.data();


      const element =
        document.createElement(
          "div"
        );


      element.className =
        "item";


      element.innerHTML = `

        <b>
          ${escapeHtml(
            data.fromName ||
            "Unknown user"
          )}
        </b>

        <br>

        <small>
          Room ID:
          ${escapeHtml(
            data.fromRoomId ||
            ""
          )}
        </small>

        <div class="actions">

          <button
            data-accept="${requestDoc.id}">
            Accept
          </button>

          <button
            class="secondary"
            data-reject="${requestDoc.id}">
            Reject
          </button>

        </div>

      `;


      $("requests")
        .appendChild(
          element
        );

    }
  );


  document
    .querySelectorAll(
      "[data-accept]"
    )
    .forEach(
      button => {

        button.onclick =
          () => {

            respond(
              button.dataset.accept,
              "accepted"
            );

          };

      }
    );


  document
    .querySelectorAll(
      "[data-reject]"
    )
    .forEach(
      button => {

        button.onclick =
          () => {

            respond(
              button.dataset.reject,
              "rejected"
            );

          };

      }
    );

}


// ======================================================
// ACCEPT / REJECT REQUEST
// ======================================================

async function respond(
  id,
  status
) {

  try {

    const requestRef =
      doc(
        db,
        "requests",
        id
      );


    const snap =
      await getDoc(
        requestRef
      );


    if (!snap.exists()) {

      return;

    }


    const requestData =
      snap.data();


    // Only receiver should respond
    if (
      requestData.toUid !==
      currentUser.uid
    ) {

      throw new Error(
        "You cannot respond to this request."
      );

    }


    await updateDoc(
      requestRef,
      {
        status:
          status
      }
    );


    if (
      status ===
      "accepted"
    ) {

      const users = [
        requestData.fromUid,
        currentUser.uid
      ].sort();


      const friendshipId =
        users.join("_");


      await setDoc(
        doc(
          db,
          "friendships",
          friendshipId
        ),
        {

          users:
            users,

          createdAt:
            serverTimestamp()

        }
      );

    }


    await refreshAll();


  } catch (error) {

    alert(
      "ERROR\n\n" +
      (error.code || "") +
      "\n\n" +
      error.message
    );

  }

}


// ======================================================
// RENDER FRIENDS
// ======================================================

async function renderFriends() {

  if (!currentUser) return;


  const q =
    await getDocs(
      query(
        collection(
          db,
          "friendships"
        ),

        where(
          "users",
          "array-contains",
          currentUser.uid
        )
      )
    );


  $("friends").innerHTML =
    "";


  if (q.empty) {

    $("friends").innerHTML =
      '<div class="empty">No friends yet.</div>';

    return;

  }


  for (
    const friendship
    of q.docs
  ) {

    const data =
      friendship.data();


    const ids =
      Array.isArray(
        data.users
      )
        ? data.users
        : [];


    const other =
      ids.find(
        uid =>
          uid !==
          currentUser.uid
      );


    if (!other) continue;


    const userSnap =
      await getDoc(
        doc(
          db,
          "users",
          other
        )
      );


    if (!userSnap.exists()) {

      continue;

    }


    const friend =
      userSnap.data();


    const element =
      document.createElement(
        "div"
      );


    element.className =
      "item";


    element.innerHTML = `

      <b>
        ${escapeHtml(
          friend.name ||
          "Friend"
        )}
      </b>

      <br>

      <small>
        Room ID:
        ${escapeHtml(
          friend.roomId ||
          ""
        )}
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


    $("friends")
      .appendChild(
        element
      );

  }

}


// ======================================================
// POST STORY
// ======================================================

$("postStoryBtn").onclick =
  async () => {

    try {

      if (!currentUser || !profile) {

        throw new Error(
          "Please login first."
        );

      }


      const text =
        $("storyText")
          .value
          .trim();


      if (!text) {

        return;

      }


      await addDoc(
        collection(
          db,
          "stories"
        ),
        {

          uid:
            currentUser.uid,

          name:
            profile.name,

          text:
            text,

          createdAt:
            serverTimestamp(),

          expiresAt:
            Date.now() +
            86400000

        }
      );


      $("storyText").value =
        "";


      await renderStories();


    } catch (error) {

      alert(
        "ERROR\n\n" +
        (error.code || "") +
        "\n\n" +
        error.message
      );

    }

  };


// ======================================================
// RENDER MY STORIES
// ======================================================

async function renderStories() {

  if (!currentUser) return;


  const now =
    Date.now();


  const q =
    await getDocs(
      query(
        collection(
          db,
          "stories"
        ),

        where(
          "uid",
          "==",
          currentUser.uid
        )
      )
    );


  $("stories").innerHTML =
    "";


  if (q.empty) {

    $("stories").innerHTML =
      '<div class="empty">No stories yet.</div>';

    return;

  }


  for (
    const storyDoc
    of q.docs
  ) {

    const story =
      storyDoc.data();


    if (
      story.expiresAt <=
      now
    ) {

      await deleteDoc(
        storyDoc.ref
      );

      continue;

    }


    const hours =
      Math.ceil(
        (
          story.expiresAt -
          now
        ) /
        3600000
      );


    const element =
      document.createElement(
        "div"
      );


    element.className =
      "item story";


    element.innerHTML = `

      <b>
        ${escapeHtml(
          story.name ||
          profile.name
        )}
      </b>

      <p>
        ${escapeHtml(
          story.text
        )}
      </p>

      <small>
        Expires in about
        ${hours}h
      </small>

    `;


    $("stories")
      .appendChild(
        element
      );

  }

}


// ======================================================
// REFRESH EVERYTHING
// ======================================================

async function refreshAll() {

  // Requests
  try {

    await renderRequests();

  } catch (error) {

    console.error(
      "Requests error:",
      error
    );

    $("requests").innerHTML =
      `<div class="empty">
        Could not load requests.
      </div>`;

  }


  // Friends
  try {

    await renderFriends();

  } catch (error) {

    console.error(
      "Friends error:",
      error
    );

    $("friends").innerHTML =
      `<div class="empty">
        Could not load friends.
      </div>`;

  }


  // Stories
  try {

    await renderStories();

  } catch (error) {

    console.error(
      "Stories error:",
      error
    );

    $("stories").innerHTML =
      `<div class="empty">
        Could not load stories.
      </div>`;

  }

}


// ======================================================
// ESCAPE HTML
// ======================================================

function escapeHtml(value) {

  return String(
    value ?? ""
  ).replace(
    /[&<>"']/g,

    character => ({

      "&":
        "&amp;",

      "<":
        "&lt;",

      ">":
        "&gt;",

      '"':
        "&quot;",

      "'":
        "&#039;"

    }[character])

  );

}
