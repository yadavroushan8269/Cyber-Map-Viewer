import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";

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
  serverTimestamp,
  onSnapshot,
  runTransaction
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-storage.js";

import {
  firebaseConfig
} from "./firebase-config.js";


const app = initializeApp(firebaseConfig);

const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);


const $ = id => document.getElementById(id);


let currentUser = null;
let profile = null;


/* =========================
   WEBRTC
========================= */

let peerConnection = null;
let localStream = null;
let remoteStream = null;

let currentCallId = null;
let currentCallData = null;

let unsubscribeCall = null;
let unsubscribeRemoteCandidates = null;
let unsubscribeMessages = null;
let unsubscribeIncomingCalls = null;

let isMuted = false;
let isCameraOff = false;

let currentFacingMode = "user";


const rtcConfig = {
  iceServers: [
    {
      urls: "stun:stun.l.google.com:19302"
    },
    {
      urls: "stun:stun1.l.google.com:19302"
    }
  ]
};


/* =========================
   ERROR
========================= */

function showError(error, location = "Firebase") {

  console.error(location, error);

  const code =
    error?.code ||
    error?.name ||
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


/* =========================
   ROOM ID
========================= */

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


async function createUniqueRoomId() {

  let roomId = makeRoomId();

  let result = await getDocs(
    query(
      collection(db, "users"),
      where("roomId", "==", roomId)
    )
  );

  while (!result.empty) {

    roomId = makeRoomId();

    result = await getDocs(
      query(
        collection(db, "users"),
        where("roomId", "==", roomId)
      )
    );

  }

  return roomId;
}


/* =========================
   LOGIN
========================= */

async function login() {

  const name =
    $("nameInput").value.trim();

  if (!name) {

    $("authMsg").textContent =
      "Enter your name.";

    return;
  }

  $("authMsg").style.color = "";

  $("authMsg").textContent =
    "Connecting...";

  try {

    const credential =
      await signInAnonymously(auth);

    currentUser =
      credential.user;

    if (!currentUser) {

      throw new Error(
        "Firebase login completed but user was not returned."
      );

    }

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

      const roomId =
        await createUniqueRoomId();

      profile = {

        name: name,

        roomId: roomId,

        createdAt:
          serverTimestamp()

      };

      await setDoc(
        userRef,
        profile
      );

    }


    $("authView").hidden = true;

    $("appView").hidden = false;

    $("welcome").textContent =
      "Hi, " + profile.name;

    $("roomId").textContent =
      profile.roomId;

    $("authMsg").textContent = "";


    await refreshAll();

    listenForIncomingCalls();


  } catch (error) {

    showError(
      error,
      "Login / Profile"
    );

  }
}


$("loginBtn").onclick =
  login;


/* =========================
   LOGOUT
========================= */

$("logoutBtn").onclick =
  async () => {

    try {

      await hangupCall(false);

      if (unsubscribeIncomingCalls) {
        unsubscribeIncomingCalls();
        unsubscribeIncomingCalls = null;
      }

      await signOut(auth);

      location.reload();

    } catch (error) {

      showError(
        error,
        "Logout"
      );

    }

  };


/* =========================
   COPY ROOM
========================= */

$("copyRoomBtn").onclick =
  async () => {

    try {

      await navigator.clipboard.writeText(
        profile.roomId
      );

      $("requestMsg").textContent =
        "Room ID copied.";

    } catch {

      $("requestMsg").textContent =
        "Could not copy Room ID.";

    }

  };


/* =========================
   FRIEND REQUEST
========================= */

$("sendRequestBtn").onclick =
  async () => {

    try {

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
        room === profile.roomId
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
        collection(db, "requests"),
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

      $("requestMsg").textContent =
        "ERROR\n" +
        (error.code || "") +
        "\n\n" +
        error.message;

    }

  };


/* =========================
   REQUESTS
========================= */

async function renderRequests() {

  const q =
    await getDocs(
      query(
        collection(db, "requests"),
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


  $("requests").innerHTML = "";


  if (q.empty) {

    $("requests").innerHTML =
      '<div class="empty">No pending requests.</div>';

    return;
  }


  q.forEach(requestDoc => {

    const data =
      requestDoc.data();

    const element =
      document.createElement("div");

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
          data.fromRoomId || ""
        )}
      </small>

      <div class="actions">

        <button
          data-accept="${requestDoc.id}"
        >
          Accept
        </button>

        <button
          class="secondary"
          data-reject="${requestDoc.id}"
        >
          Reject
        </button>

      </div>

    `;


    $("requests")
      .appendChild(element);

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


/* =========================
   ACCEPT / REJECT
========================= */

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
      await getDoc(requestRef);

    if (!snap.exists()) return;


    const data =
      snap.data();


    if (
      data.toUid !==
      currentUser.uid
    ) {

      throw new Error(
        "You cannot respond to this request."
      );

    }


    await updateDoc(
      requestRef,
      {
        status: status
      }
    );


    if (status === "accepted") {

      const users = [

        data.fromUid,

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

          users: users,

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


/* =========================
   FRIENDS
========================= */

async function renderFriends() {

  const q =
    await getDocs(
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


  for (
    const friendship of q.docs
  ) {

    const data =
      friendship.data();

    const ids =
      Array.isArray(data.users)
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


    if (!userSnap.exists())
      continue;


    const friend =
      userSnap.data();


    const element =
      document.createElement("div");

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

        <button
          data-call="${other}"
          data-name="${escapeHtml(
            friend.name ||
            "Friend"
          )}"
        >
          📹 Video Call
        </button>

      </div>

    `;


    $("friends")
      .appendChild(element);

  }


  document
    .querySelectorAll("[data-call]")
    .forEach(button => {

      button.onclick = () => {

        startCall(
          button.dataset.call,
          button.dataset.name
        );

      };

    });

}


/* =========================
   STORY
   ONE PER 24 HOURS
========================= */

$("postStoryBtn").onclick =
  postStory;


async function postStory() {

  try {

    if (
      !currentUser ||
      !profile
    ) {

      throw new Error(
        "Please login first."
      );

    }


    const text =
      $("storyText")
        .value
        .trim();

    const file =
      $("storyFile")
        .files[0];


    if (!text && !file) {

      $("storyMsg").textContent =
        "Write something or select an image/video.";

      return;
    }


    $("storyMsg").textContent =
      "Checking story limit...";


    const slotRef =
      doc(
        db,
        "storySlots",
        currentUser.uid
      );


    const now =
      Date.now();


    const expiresAt =
      now + 86400000;


    let storyAllowed = false;


    await runTransaction(
      db,
      async transaction => {

        const slotSnap =
          await transaction.get(
            slotRef
          );


        if (
          slotSnap.exists()
        ) {

          const old =
            slotSnap.data();


          if (
            old.expiresAt &&
            old.expiresAt > now
          ) {

            throw new Error(
              "You already posted a story. You can post another one after 24 hours."
            );

          }

        }


        transaction.set(
          slotRef,
          {

            uid:
              currentUser.uid,

            expiresAt:
              expiresAt,

            updatedAt:
              serverTimestamp()

          }
        );


        storyAllowed = true;

      }
    );


    if (!storyAllowed)
      return;


    $("storyMsg").textContent =
      "Uploading story...";


    let mediaUrl =
      "";

    let mediaType =
      "text";


    if (file) {

      const maxSize =
        20 * 1024 * 1024;


      if (
        file.size >
        maxSize
      ) {

        throw new Error(
          "File must be 20 MB or smaller."
        );

      }


      if (
        file.type.startsWith(
          "image/"
        )
      ) {

        mediaType =
          "image";

      } else if (
        file.type.startsWith(
          "video/"
        )
      ) {

        mediaType =
          "video";

      } else {

        throw new Error(
          "Only image or video files are allowed."
        );

      }


      const storageRef =
        ref(
          storage,
          `stories/${currentUser.uid}/${Date.now()}_${safeFileName(file.name)}`
        );


      const upload =
        await uploadBytes(
          storageRef,
          file,
          {
            contentType:
              file.type
          }
        );


      mediaUrl =
        await getDownloadURL(
          upload.ref
        );

    }


    await setDoc(
      doc(
        db,
        "stories",
        currentUser.uid
      ),
      {

        uid:
          currentUser.uid,

        name:
          profile.name,

        text:
          text,

        mediaUrl:
          mediaUrl,

        mediaType:
          mediaType,

        createdAt:
          serverTimestamp(),

        expiresAt:
          expiresAt

      }
    );


    $("storyText").value =
      "";

    $("storyFile").value =
      "";


    $("storyMsg").textContent =
      "Story posted successfully.";


    await renderStories();


  } catch (error) {

    console.error(
      "Story error:",
      error
    );


    $("storyMsg").style.whiteSpace =
      "pre-wrap";


    $("storyMsg").textContent =
      "ERROR\n\n" +
      (
        error.message ||
        error.code ||
        String(error)
      );

  }

}


/* =========================
   STORIES
========================= */

async function renderStories() {

  const q =
    await getDocs(
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


  if (q.empty) {

    $("stories").innerHTML =
      '<div class="empty">No stories yet.</div>';

    return;
  }


  for (
    const storyDoc of q.docs
  ) {

    const story =
      storyDoc.data();


    if (
      story.expiresAt <=
      Date.now()
    ) {

      await deleteDoc(
        storyDoc.ref
      );

      continue;
    }


    const element =
      document.createElement("div");

    element.className =
      "item story";


    let media = "";


    if (
      story.mediaType ===
      "image" &&
      story.mediaUrl
    ) {

      media = `
        <img
          src="${escapeHtml(
            story.mediaUrl
          )}"
          class="story-media"
          alt="Story"
        >
      `;

    }


    if (
      story.mediaType ===
      "video" &&
      story.mediaUrl
    ) {

      media = `
        <video
          src="${escapeHtml(
            story.mediaUrl
          )}"
          class="story-media"
          controls
          playsinline
        ></video>
      `;

    }


    element.innerHTML = `

      <b>
        ${escapeHtml(
          story.name ||
          profile.name
        )}
      </b>

      ${
        story.text
          ? `<p>${escapeHtml(
              story.text
            )}</p>`
          : ""
      }

      ${media}

      <small>
        Story expires after 24 hours.
      </small>

    `;


    $("stories")
      .appendChild(element);

  }

}


/* =========================
   START CALL
========================= */

async function startCall(
  friendUid,
  friendName
) {

  try {

    if (
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {

      throw new Error(
        "Camera/Microphone is unavailable. Open the GitHub Pages HTTPS link in a supported browser."
      );

    }


    $("callView").hidden =
      false;

    $("callTitle").textContent =
      "Calling " +
      friendName;

    $("callStatus").textContent =
      "Requesting camera and microphone permission...";


    await prepareLocalMedia();


    peerConnection =
      createPeerConnection();


    const callRef =
      doc(
        collection(db, "calls")
      );


    currentCallId =
      callRef.id;


    currentCallData = {

      callerUid:
        currentUser.uid,

      calleeUid:
        friendUid,

      callerName:
        profile.name,

      calleeName:
        friendName,

      status:
        "ringing",

      createdAt:
        serverTimestamp()

    };


    await setDoc(
      callRef,
      currentCallData
    );


    const offer =
      await peerConnection
        .createOffer();


    await peerConnection
      .setLocalDescription(
        offer
      );


    await updateDoc(
      callRef,
      {
        offer: {
          type:
            offer.type,

          sdp:
            offer.sdp
        }
      }
    );


    listenToCallerAnswer(
      callRef
    );


    $("callStatus").textContent =
      "Calling...";


  } catch (error) {

    handleMediaError(
      error,
      "Starting call"
    );

    await closeLocalMedia();

    $("callView").hidden =
      true;

  }

}


/* =========================
   MEDIA
========================= */

async function prepareLocalMedia() {

  await closeLocalMedia();


  try {

    localStream =
      await navigator.mediaDevices
        .getUserMedia({

          audio: true,

          video: {

            facingMode:
              currentFacingMode

          }

        });


    $("localVideo").srcObject =
      localStream;


    $("localVideo").play()
      .catch(() => {});


  } catch (error) {

    throw error;

  }

}


function handleMediaError(
  error,
  location
) {

  console.error(
    location,
    error
  );


  let message =
    error?.message ||
    String(error);


  if (
    error?.name ===
    "NotAllowedError"
  ) {

    message =
      "Camera/Microphone permission denied.\n\n" +
      "Phone Settings → Apps → Browser → Permissions → Camera + Microphone → Allow.\n\n" +
      "Then reload the website.";

  }


  if (
    error?.name ===
    "NotFoundError"
  ) {

    message =
      "Camera or microphone was not found.";

  }


  if (
    error?.name ===
    "NotReadableError"
  ) {

    message =
      "Camera/microphone is already being used by another app.";

  }


  $("callStatus").textContent =
    message;

  alert(
    location +
    "\n\n" +
    message
  );

}


function createPeerConnection() {

  const pc =
    new RTCPeerConnection(
      rtcConfig
    );


  remoteStream =
    new MediaStream();


  $("remoteVideo").srcObject =
    remoteStream;


  if (localStream) {

    localStream
      .getTracks()
      .forEach(track => {

        pc.addTrack(
          track,
          localStream
        );

      });

  }


  pc.ontrack =
    event => {

      event.streams[0]
        .getTracks()
        .forEach(track => {

          remoteStream.addTrack(
            track
          );

        });


      $("remoteVideo")
        .play()
        .catch(() => {});

    };


  pc.onicecandidate =
    async event => {

      if (
        !event.candidate ||
        !currentCallId
      ) return;


      const sub =
        currentCallData.callerUid ===
        currentUser.uid
          ? "callerCandidates"
          : "calleeCandidates";


      await addDoc(
        collection(
          db,
          "calls",
          currentCallId,
          sub
        ),
        event.candidate.toJSON()
      );

    };


  pc.onconnectionstatechange =
    () => {

      const state =
        pc.connectionState;


      if (
        state ===
        "connected"
      ) {

        $("callStatus").textContent =
          "Connected";

      }


      if (
        state ===
        "disconnected" ||
        state ===
        "failed"
      ) {

        $("callStatus").textContent =
          "Connection lost.";

      }

    };


  return pc;

}


/* =========================
   CALLER ANSWER
========================= */

function listenToCallerAnswer(
  callRef
) {

  if (unsubscribeCall)
    unsubscribeCall();


  unsubscribeCall =
    onSnapshot(
      callRef,
      async snap => {

        if (!snap.exists())
          return;


        const data =
          snap.data();


        if (
          data.answer &&
          peerConnection &&
          !peerConnection
            .currentRemoteDescription
        ) {

          await peerConnection
            .setRemoteDescription(
              new RTCSessionDescription(
                data.answer
              )
            );

          $("callStatus").textContent =
            "Connected";

        }


        if (
          data.status ===
          "rejected"
        ) {

          $("callStatus").textContent =
            "Call rejected.";

          setTimeout(
            () => hangupCall(false),
            1000
          );

        }

      }
    );


  unsubscribeRemoteCandidates =
    onSnapshot(
      collection(
        db,
        "calls",
        currentCallId,
        "calleeCandidates"
      ),
      snapshot => {

        snapshot.docChanges()
          .forEach(async change => {

            if (
              change.type !==
              "added"
            ) return;


            if (!peerConnection)
              return;


            try {

              await peerConnection
                .addIceCandidate(
                  new RTCIceCandidate(
                    change.doc.data()
                  )
                );

            } catch (error) {

              console.error(
                "ICE error",
                error
              );

            }

          });

      }
    );

}


/* =========================
   INCOMING CALLS
========================= */

function listenForIncomingCalls() {

  if (unsubscribeIncomingCalls)
    unsubscribeIncomingCalls();


  unsubscribeIncomingCalls =
    onSnapshot(
      query(
        collection(db, "calls"),
        where(
          "calleeUid",
          "==",
          currentUser.uid
        ),
        where(
          "status",
          "==",
          "ringing"
        )
      ),
      snapshot => {

        snapshot.docChanges()
          .forEach(change => {

            if (
              change.type !==
              "added"
            ) return;


            const data =
              change.doc.data();


            if (
              currentCallId
            ) return;


            currentCallId =
              change.doc.id;

            currentCallData =
              data;


            $("incomingCallText")
              .textContent =
              data.callerName +
              " is calling you.";

            $("incomingCall")
              .hidden =
              false;

          });

      }
    );

}


/* =========================
   ACCEPT CALL
========================= */

$("acceptCallBtn").onclick =
  acceptIncomingCall;


async function acceptIncomingCall() {

  try {

    $("incomingCall").hidden =
      true;

    $("callView").hidden =
      false;


    $("callTitle").textContent =
      "Call with " +
      currentCallData.callerName;


    $("callStatus").textContent =
      "Requesting camera and microphone permission...";


    await prepareLocalMedia();


    peerConnection =
      createPeerConnection();


    const callRef =
      doc(
        db,
        "calls",
        currentCallId
      );


    const snap =
      await getDoc(callRef);


    if (!snap.exists()) {

      throw new Error(
        "Call no longer exists."
      );

    }


    const data =
      snap.data();


    currentCallData =
      data;


    await peerConnection
      .setRemoteDescription(
        new RTCSessionDescription(
          data.offer
        )
      );


    const answer =
      await peerConnection
        .createAnswer();


    await peerConnection
      .setLocalDescription(
        answer
      );


    await updateDoc(
      callRef,
      {

        answer: {

          type:
            answer.type,

          sdp:
            answer.sdp

        },

        status:
          "accepted"

      }
    );


    unsubscribeRemoteCandidates =
      onSnapshot(
        collection(
          db,
          "calls",
          currentCallId,
          "callerCandidates"
        ),
        snapshot => {

          snapshot.docChanges()
            .forEach(async change => {

              if (
                change.type !==
                "added"
              ) return;


              try {

                await peerConnection
                  .addIceCandidate(
                    new RTCIceCandidate(
                      change.doc.data()
                    )
                  );

              } catch (error) {

                console.error(
                  error
                );

              }

            });

        }
      );


    $("callStatus").textContent =
      "Connected";


    listenToCallMessages();


  } catch (error) {

    handleMediaError(
      error,
      "Accepting call"
    );

    await rejectIncomingCall();

  }

}


/* =========================
   REJECT
========================= */

$("rejectCallBtn").onclick =
  rejectIncomingCall;


async function rejectIncomingCall() {

  try {

    if (currentCallId) {

      await updateDoc(
        doc(
          db,
          "calls",
          currentCallId
        ),
        {
          status:
            "rejected"
        }
      );

    }

  } catch (error) {

    console.error(
      error
    );

  }


  $("incomingCall").hidden =
    true;


  currentCallId =
    null;

  currentCallData =
    null;

}


/* =========================
   HANGUP
========================= */

$("hangupBtn").onclick =
  () => hangupCall(true);


$("closeCallBtn").onclick =
  () => hangupCall(true);


async function hangupCall(
  updateServer = true
) {

  try {

    if (
      updateServer &&
      currentCallId
    ) {

      try {

        await updateDoc(
          doc(
            db,
            "calls",
            currentCallId
          ),
          {
            status:
              "ended"
          }
        );

      } catch (error) {

        console.error(
          error
        );

      }

    }


    if (unsubscribeCall) {

      unsubscribeCall();

      unsubscribeCall =
        null;

    }


    if (
      unsubscribeRemoteCandidates
    ) {

      unsubscribeRemoteCandidates();

      unsubscribeRemoteCandidates =
        null;

    }


    if (unsubscribeMessages) {

      unsubscribeMessages();

      unsubscribeMessages =
        null;

    }


    if (peerConnection) {

      peerConnection.close();

      peerConnection =
        null;

    }


    await closeLocalMedia();


    $("remoteVideo").srcObject =
      null;

    $("localVideo").srcObject =
      null;


    $("callView").hidden =
      true;

    $("chatPanel").hidden =
      true;


    currentCallId =
      null;

    currentCallData =
      null;

    isMuted =
      false;

    isCameraOff =
      false;


    $("muteBtn").textContent =
      "🎤 Mute";

    $("cameraBtn").textContent =
      "📷 Camera";


  } catch (error) {

    console.error(
      "Hangup",
      error
    );

  }

}


async function closeLocalMedia() {

  if (!localStream)
    return;


  localStream
    .getTracks()
    .forEach(track => {

      track.stop();

    });


  localStream =
    null;

}


/* =========================
   MUTE
========================= */

$("muteBtn").onclick =
  () => {

    if (!localStream)
      return;


    isMuted =
      !isMuted;


    localStream
      .getAudioTracks()
      .forEach(track => {

        track.enabled =
          !isMuted;

      });


    $("muteBtn").textContent =
      isMuted
        ? "🔇 Unmute"
        : "🎤 Mute";

  };


/* =========================
   CAMERA
========================= */

$("cameraBtn").onclick =
  () => {

    if (!localStream)
      return;


    isCameraOff =
      !isCameraOff;


    localStream
      .getVideoTracks()
      .forEach(track => {

        track.enabled =
          !isCameraOff;

      });


    $("cameraBtn").textContent =
      isCameraOff
        ? "📷 Camera On"
        : "📷 Camera Off";

  };


/* =========================
   SWITCH CAMERA
========================= */

$("switchCameraBtn").onclick =
  async () => {

    try {

      currentFacingMode =
        currentFacingMode ===
        "user"
          ? "environment"
          : "user";


      const newStream =
        await navigator.mediaDevices
          .getUserMedia({

            audio: true,

            video: {

              facingMode:
                currentFacingMode

            }

          });


      const newVideoTrack =
        newStream.getVideoTracks()[0];


      const sender =
        peerConnection
          ?.getSenders()
          .find(
            s =>
              s.track &&
              s.track.kind ===
              "video"
          );


      if (sender) {

        await sender
          .replaceTrack(
            newVideoTrack
          );

      }


      if (localStream) {

        localStream
          .getVideoTracks()
          .forEach(
            track =>
              track.stop()
          );


        localStream.removeTrack(
          localStream
            .getVideoTracks()[0]
        );


        localStream.addTrack(
          newVideoTrack
        );

      } else {

        localStream =
          newStream;

      }


      $("localVideo").srcObject =
        localStream;


    } catch (error) {

      handleMediaError(
        error,
        "Switch camera"
      );

    }

  };


/* =========================
   CALL CHAT
========================= */

$("chatBtn").onclick =
  () => {

    $("chatPanel").hidden =
      !$("chatPanel").hidden;


    if (
      !$("chatPanel").hidden
    ) {

      listenToCallMessages();

    }

  };


$("sendCallMessageBtn").onclick =
  sendCallMessage;


$("callMessageInput").addEventListener(
  "keydown",
  event => {

    if (
      event.key ===
      "Enter"
    ) {

      sendCallMessage();

    }

  }
);


async function sendCallMessage() {

  const input =
    $("callMessageInput");

  const text =
    input.value.trim();


  if (
    !text ||
    !currentCallId
  ) return;


  await addDoc(
    collection(
      db,
      "calls",
      currentCallId,
      "messages"
    ),
    {

      uid:
        currentUser.uid,

      name:
        profile.name,

      text:
        text,

      createdAt:
        serverTimestamp()

    }
  );


  input.value =
    "";

}


function listenToCallMessages() {

  if (
    !currentCallId
  ) return;


  if (unsubscribeMessages)
    unsubscribeMessages();


  unsubscribeMessages =
    onSnapshot(
      collection(
        db,
        "calls",
        currentCallId,
        "messages"
      ),
      snapshot => {

        $("callMessages")
          .innerHTML = "";


        const messages =
          [];


        snapshot.forEach(
          messageDoc => {

            messages.push(
              messageDoc.data()
            );

          }
        );


        messages.sort(
          (a, b) => {

            const aTime =
              a.createdAt
                ?.seconds || 0;

            const bTime =
              b.createdAt
                ?.seconds || 0;

            return (
              aTime -
              bTime
            );

          }
        );


        messages.forEach(
          message => {

            const element =
              document.createElement(
                "div"
              );


            element.className =
              message.uid ===
              currentUser.uid
                ? "message mine"
                : "message";


            element.innerHTML = `

              <b>
                ${escapeHtml(
                  message.name ||
                  ""
                )}
              </b>

              <div>
                ${escapeHtml(
                  message.text ||
                  ""
                )}
              </div>

            `;


            $("callMessages")
              .appendChild(
                element
              );

          }
        );


        $("callMessages")
          .scrollTop =
          $("callMessages")
            .scrollHeight;

      }
    );

}


/* =========================
   HELPERS
========================= */

function safeFileName(name) {

  return String(name)
    .replace(
      /[^a-zA-Z0-9._-]/g,
      "_"
    );

}


function escapeHtml(value) {

  return String(
    value ?? ""
  ).replace(
    /[&<>"']/g,
    character =>
      ({

        "&": "&amp;",

        "<": "&lt;",

        ">": "&gt;",

        '"': "&quot;",

        "'": "&#039;"

      }[character])
  );

}


/* =========================
   REFRESH
========================= */

async function refreshAll() {

  try {

    await renderRequests();

  } catch (error) {

    console.error(
      "Requests",
      error
    );

  }


  try {

    await renderFriends();

  } catch (error) {

    console.error(
      "Friends",
      error
    );

  }


  try {

    await renderStories();

  } catch (error) {

    console.error(
      "Stories",
      error
    );

  }

}
