/* =========================================================
   PASTSNAP — FINAL APP.JS
   Cyber UI + Supabase + Leaflet + Camera + GPS + Calls
========================================================= */

"use strict";

/* =========================================================
   CONFIG
========================================================= */

const SUPABASE_URL =
  "https://zzxhymydsvwpjbyaslde.supabase.co";

const SUPABASE_KEY =
  "sb_publishable_kqNMaZBD7Rg8P-pBwBYl9A_nGYn3JJ4";

const supabaseClient =
  window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
  );

const socket = io();

/* =========================================================
   GLOBAL STATE
========================================================= */

let currentUser = null;
let currentProfile = null;

let myRoom = null;

let map = null;
let userMarker = null;
let accuracyCircle = null;

let snaps = [];
let snapMarkers = [];

let currentViewerIndex = 0;
let currentClusterSnaps = [];

let currentStream = null;
let currentFacingMode = "user";

let capturedBlob = null;
let capturedType = null;
let capturedLatitude = null;
let capturedLongitude = null;

let gpsWatchId = null;
let lockedGPS = null;

let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;

let activeCall = false;
let incomingCallerId = null;
let incomingCallerRoom = null;
let activePeerId = null;

let localCallStream = null;
let peerConnection = null;

let micEnabled = true;
let cameraEnabled = true;

let chatTargetRoom = null;

let lastSnapId = null;

let mapRotation = 0;


/* =========================================================
   DOM HELPERS
========================================================= */

function $(id) {
  return document.getElementById(id);
}

function show(id) {
  const el = $(id);
  if (el) el.classList.remove("hidden");
}

function hide(id) {
  const el = $(id);
  if (el) el.classList.add("hidden");
}

function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}


/* =========================================================
   CYBER SOUND SYSTEM
========================================================= */

let audioContext = null;

function getAudioContext() {
  try {
    if (!audioContext) {
      audioContext =
        new (window.AudioContext ||
          window.webkitAudioContext)();
    }

    if (audioContext.state === "suspended") {
      audioContext.resume();
    }

    return audioContext;
  } catch (e) {
    return null;
  }
}

function cyberTone(
  frequency = 600,
  duration = 0.05,
  type = "square",
  volume = 0.025
) {
  const ctx = getAudioContext();

  if (!ctx) return;

  try {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.type = type;
    oscillator.frequency.value = frequency;

    gain.gain.setValueAtTime(
      volume,
      ctx.currentTime
    );

    gain.gain.exponentialRampToValueAtTime(
      0.001,
      ctx.currentTime + duration
    );

    oscillator.connect(gain);
    gain.connect(ctx.destination);

    oscillator.start();

    oscillator.stop(
      ctx.currentTime + duration
    );
  } catch (e) {}
}

function cyberClick() {
  cyberTone(650, 0.035);
}

function cyberTyping() {
  cyberTone(420, 0.018, "square", 0.012);
}

function cyberSuccess() {
  cyberTone(600, 0.05);
  setTimeout(() => cyberTone(900, 0.07), 55);
}

function cyberError() {
  cyberTone(180, 0.12, "sawtooth", 0.018);
}

function cyberCall() {
  cyberTone(500, 0.08);
  setTimeout(() => cyberTone(750, 0.08), 100);
}

function cyberMessage() {
  cyberTone(700, 0.04);
}


/* =========================================================
   TERMINAL
========================================================= */

function terminalLog(message) {
  const output = $("terminalOutput");

  if (!output) return;

  const line =
    document.createElement("div");

  line.textContent =
    "> " + message;

  output.appendChild(line);

  while (output.children.length > 12) {
    output.removeChild(
      output.firstChild
    );
  }

  output.scrollTop =
    output.scrollHeight;
}

setInterval(() => {
  const el = $("terminalTime");

  if (!el) return;

  const d = new Date();

  el.textContent =
    d.toLocaleTimeString(
      "en-IN",
      { hour12: false }
    );
}, 1000);


/* =========================================================
   STATUS
========================================================= */

function showStatus(
  message,
  duration = 3000
) {
  const el = $("status");

  if (!el) return;

  el.textContent = "";

  let i = 0;

  const timer =
    setInterval(() => {

      if (i >= message.length) {
        clearInterval(timer);
        return;
      }

      el.textContent += message[i];

      if (
        message[i] !== " "
      ) {
        cyberTone(
          380 + Math.random() * 100,
          0.012,
          "square",
          0.006
        );
      }

      i++;

    }, 18);

  terminalLog(message);

  if (duration > 0) {
    setTimeout(() => {
      if (
        el.textContent === message
      ) {
        el.textContent =
          "SYSTEM READY...";
      }
    }, duration);
  }
}


/* =========================================================
   GLOBAL BUTTON SOUND
========================================================= */

document.addEventListener(
  "pointerdown",
  event => {

    const button =
      event.target.closest("button");

    if (button) {
      cyberClick();
    }

  },
  true
);

document.addEventListener(
  "keydown",
  event => {

    const tag =
      event.target.tagName;

    if (
      tag === "INPUT" ||
      tag === "TEXTAREA"
    ) {

      if (
        event.key.length === 1 ||
        event.key === "Backspace"
      ) {
        cyberTyping();
      }
    }

  },
  true
);


/* =========================================================
   ROOM ID
========================================================= */

function generateRoomId() {

  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  let result = "";

  for (let i = 0; i < 6; i++) {

    result +=
      chars[
        Math.floor(
          Math.random() *
          chars.length
        )
      ];

  }

  return result;
}


async function createMyRoom() {

  if (!currentUser)
    return null;

  if (myRoom) {

    setText(
      "myCallId",
      myRoom
    );

    return myRoom;
  }

  try {

    const {
      data,
      error
    } =
      await supabaseClient
        .from("profiles")
        .select("call_room_id")
        .eq(
          "id",
          currentUser.id
        )
        .maybeSingle();

    if (error)
      throw error;

    if (data?.call_room_id) {

      myRoom =
        data.call_room_id;

      setText(
        "myCallId",
        myRoom
      );

      return myRoom;
    }

    for (
      let attempt = 0;
      attempt < 8;
      attempt++
    ) {

      const newRoom =
        generateRoomId();

      const {
        data: updateData,
        error: updateError
      } =
        await supabaseClient
          .from("profiles")
          .update({
            call_room_id:
              newRoom
          })
          .eq(
            "id",
            currentUser.id
          )
          .select(
            "call_room_id"
          )
          .maybeSingle();

      if (
        !updateError &&
        updateData?.call_room_id
      ) {

        myRoom =
          updateData.call_room_id;

        setText(
          "myCallId",
          myRoom
        );

        terminalLog(
          "PERMANENT CALL ID: " +
          myRoom
        );

        return myRoom;
      }
    }

  } catch (error) {

    console.error(
      "CALL ROOM:",
      error
    );

  }

  showStatus(
    "Permanent Call ID create nahi hua.",
    5000
  );

  return null;
}


async function joinOwnCallRoom() {

  if (!currentUser)
    return null;

  const room =
    await createMyRoom();

  if (!room)
    return null;

  socket.emit(
    "join-room",
    room
  );

  setText(
    "myCallId",
    room
  );

  terminalLog(
    "CALL ROOM CONNECTED: " +
    room
  );

  return room;
}


/* =========================================================
   AUTH UI
========================================================= */

function openAuth(mode = "login") {

  show("authModal");

  if (mode === "register") {

    hide("loginForm");
    show("registerForm");

    setText(
      "authTitle",
      "REGISTER"
    );

  } else {

    show("loginForm");
    hide("registerForm");

    setText(
      "authTitle",
      "LOGIN"
    );

  }

  if ($("authMessage"))
    $("authMessage").textContent = "";
}


function closeAuth() {
  hide("authModal");
}


$("closeAuthBtn")?.addEventListener(
  "click",
  closeAuth
);


$("showRegisterBtn")?.addEventListener(
  "click",
  () => openAuth("register")
);


$("showLoginBtn")?.addEventListener(
  "click",
  () => openAuth("login")
);


/* =========================================================
   LOGIN
========================================================= */

$("loginBtn")?.addEventListener(
  "click",
  async () => {

    const email =
      $("loginEmail")
        ?.value
        .trim();

    const password =
      $("loginPassword")
        ?.value;

    if (!email || !password) {

      setText(
        "authMessage",
        "EMAIL AND PASSWORD REQUIRED."
      );

      cyberError();

      return;
    }

    try {

      setText(
        "authMessage",
        "AUTHENTICATING..."
      );

      const {
        data,
        error
      } =
        await supabaseClient.auth
          .signInWithPassword({
            email,
            password
          });

      if (error)
        throw error;

      currentUser =
        data.user;

      await loadCurrentProfile();

      await joinOwnCallRoom();

      closeAuth();

      updateAccountUI();

      await loadSnaps();
      await loadNotifications();

      showStatus(
        "LOGIN SUCCESSFUL.",
        2500
      );

      cyberSuccess();

    } catch (error) {

      console.error(
        "LOGIN:",
        error
      );

      setText(
        "authMessage",
        error.message ||
        "LOGIN FAILED."
      );

      cyberError();
    }

  }
);


/* =========================================================
   REGISTER
========================================================= */

$("registerBtn")?.addEventListener(
  "click",
  async () => {

    const name =
      $("registerName")
        ?.value
        .trim();

    const email =
      $("registerEmail")
        ?.value
        .trim();

    const password =
      $("registerPassword")
        ?.value;

    if (!name || !email || !password) {

      setText(
        "authMessage",
        "ALL FIELDS REQUIRED."
      );

      cyberError();

      return;
    }

    try {

      setText(
        "authMessage",
        "CREATING ACCOUNT..."
      );

      const {
        data,
        error
      } =
        await supabaseClient.auth
          .signUp({
            email,
            password,
            options: {
              data: {
                display_name:
                  name
              }
            }
          });

      if (error)
        throw error;

      if (!data.user) {

        setText(
          "authMessage",
          "CHECK YOUR EMAIL TO CONFIRM ACCOUNT."
        );

        return;
      }

      currentUser =
        data.user;

      const room =
        generateRoomId();

      const {
        error: profileError
      } =
        await supabaseClient
          .from("profiles")
          .upsert(
            {
              id:
                currentUser.id,
              display_name:
                name,
              call_room_id:
                room
            },
            {
              onConflict: "id"
            }
          );

      if (profileError)
        console.error(
          "PROFILE:",
          profileError
        );

      myRoom = room;

      await loadCurrentProfile();
      await joinOwnCallRoom();

      closeAuth();

      updateAccountUI();

      showStatus(
        "ACCOUNT CREATED. CALL ID READY.",
        3500
      );

      cyberSuccess();

    } catch (error) {

      console.error(
        "REGISTER:",
        error
      );

      setText(
        "authMessage",
        error.message ||
        "REGISTRATION FAILED."
      );

      cyberError();
    }

  }
);


/* =========================================================
   PROFILE
========================================================= */

async function loadCurrentProfile() {

  if (!currentUser)
    return;

  try {

    const {
      data,
      error
    } =
      await supabaseClient
        .from("profiles")
        .select("*")
        .eq(
          "id",
          currentUser.id
        )
        .maybeSingle();

    if (error)
      throw error;

    currentProfile =
      data || null;

    if (
      currentProfile?.call_room_id
    ) {

      myRoom =
        currentProfile.call_room_id;

      setText(
        "myCallId",
        myRoom
      );

    }

    setText(
      "profileName",
      currentProfile?.display_name ||
      "USER"
    );

    setText(
      "profileEmail",
      currentUser.email ||
      ""
    );

    setText(
      "profileCallRoom",
      myRoom || "------"
    );

  } catch (error) {

    console.error(
      "PROFILE LOAD:",
      error
    );

  }
}


function updateAccountUI() {

  const button =
    $("accountBtn");

  if (!button)
    return;

  button.textContent =
    currentUser
      ? "👤"
      : "LOGIN";
}


$("accountBtn")?.addEventListener(
  "click",
  async () => {

    if (!currentUser) {

      openAuth("login");

      return;
    }

    show("profilePanel");

    await loadCurrentProfile();
  }
);


$("closeProfileBtn")?.addEventListener(
  "click",
  () => hide("profilePanel")
);


$("profileLogoutBtn")?.addEventListener(
  "click",
  async () => {

    try {

      await supabaseClient.auth.signOut();

      currentUser = null;
      currentProfile = null;
      myRoom = null;

      hide("profilePanel");
      hide("callPanel");

      updateAccountUI();

      showStatus(
        "LOGOUT SUCCESSFUL."
      );

    } catch (error) {

      console.error(
        "LOGOUT:",
        error
      );

    }

  }
);


/* =========================================================
   SESSION
========================================================= */

async function restoreSession() {

  try {

    const {
      data
    } =
      await supabaseClient.auth
        .getSession();

    currentUser =
      data.session?.user ||
      null;

    if (currentUser) {

      await loadCurrentProfile();

      await joinOwnCallRoom();

      await loadNotifications();

    }

    updateAccountUI();

  } catch (error) {

    console.error(
      "SESSION:",
      error
    );

  }
}


supabaseClient.auth.onAuthStateChange(
  async (_event, session) => {

    currentUser =
      session?.user || null;

    if (currentUser) {

      await loadCurrentProfile();
      await joinOwnCallRoom();

      updateAccountUI();

    } else {

      currentProfile = null;
      myRoom = null;

      updateAccountUI();
    }

  }
);


/* =========================================================
   MAP INITIALIZATION
========================================================= */

function initMap() {

  map =
    L.map(
      "map",
      {
        zoomControl: true,
        attributionControl: true,
        worldCopyJump: true
      }
    ).setView(
      [20.5937, 78.9629],
      5
    );


  L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 20,
      attribution:
        "&copy; OpenStreetMap contributors"
    }
  ).addTo(map);


  terminalLog(
    "MAP INITIALIZED"
  );

  setupMapRotation();

  map.on(
    "click",
    () => {
      /*
        IMPORTANT:
        Map click does NOT open camera.
      */
    }
  );

}


/* =========================================================
   360 DEGREE MAP ROTATION
========================================================= */

function setupMapRotation() {

  if (!map)
    return;

  /*
    Leaflet itself does not provide native
    360° bearing rotation.

    We maintain a visual rotation layer
    so the map can be rotated with the
    compass control.

    Normal pan/zoom remains available.
  */

  const mapElement =
    $("map");

  if (!mapElement)
    return;

  mapElement.style.transformOrigin =
    "center center";

  mapElement.style.transition =
    "transform .35s ease";

  $("compassBtn")?.addEventListener(
    "click",
    () => {

      mapRotation += 45;

      if (mapRotation >= 360)
        mapRotation -= 360;

      rotateMap(
        mapRotation
      );

      setText(
        "mapModeText",
        "ROTATION " +
        mapRotation +
        "°"
      );

    }
  );

}


function rotateMap(degrees) {

  const mapElement =
    $("map");

  if (!mapElement)
    return;

  mapElement.style.transform =
    `rotate(${degrees}deg)`;

  setTimeout(() => {

    if (map) {
      map.invalidateSize();
    }

  }, 380);
}


$("mapModeBtn")?.addEventListener(
  "click",
  () => {

    mapRotation = 0;

    rotateMap(0);

    setText(
      "mapModeText",
      "CYBER MODE"
    );

  }
);


/* =========================================================
   GPS
========================================================= */

function startGPS() {

  if (!navigator.geolocation) {

    setText(
      "gpsStatus",
      "NOT SUPPORTED"
    );

    return;
  }

  gpsWatchId =
    navigator.geolocation.watchPosition(
      position => {

        const {
          latitude,
          longitude,
          accuracy
        } = position.coords;

        setText(
          "gpsStatus",
          Math.round(accuracy) +
          "M"
        );

        updateUserLocation(
          latitude,
          longitude,
          accuracy
        );

      },
      error => {

        console.error(
          "GPS:",
          error
        );

        setText(
          "gpsStatus",
          "ERROR"
        );

      },
      {
        enableHighAccuracy: true,
        maximumAge: 2000,
        timeout: 10000
      }
    );
}


function updateUserLocation(
  lat,
  lng,
  accuracy
) {

  if (!map)
    return;

  const point =
    [lat, lng];

  if (!userMarker) {

    const icon =
      L.divIcon({
        className: "",
        html:
          '<div class="gpsMarker"></div>',
        iconSize: [18, 18],
        iconAnchor: [9, 9]
      });

    userMarker =
      L.marker(
        point,
        { icon }
      ).addTo(map);

    userMarker.bindPopup(
      "YOU ARE HERE"
    );

    accuracyCircle =
      L.circle(
        point,
        {
          radius: accuracy || 20,
          color: "#00ff66",
          fillColor: "#00ff66",
          fillOpacity: .04,
          weight: 1
        }
      ).addTo(map);

  } else {

    userMarker.setLatLng(point);

    if (accuracyCircle) {

      accuracyCircle.setLatLng(point);
      accuracyCircle.setRadius(
        accuracy || 20
      );

    }

  }

}


function getCurrentPosition() {

  return new Promise(
    (resolve, reject) => {

      if (!navigator.geolocation) {

        reject(
          new Error(
            "GPS not supported"
          )
        );

        return;
      }

      navigator.geolocation.getCurrentPosition(
        resolve,
        reject,
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0
        }
      );

    }
  );
}


/* =========================================================
   MY LOCATION
========================================================= */

$("myLocationBtn")?.addEventListener(
  "click",
  async () => {

    try {

      const position =
        await getCurrentPosition();

      const lat =
        position.coords.latitude;

      const lng =
        position.coords.longitude;

      updateUserLocation(
        lat,
        lng,
        position.coords.accuracy
      );

      map.setView(
        [lat, lng],
        17
      );

      /*
        Only My Location opens camera.
      */

      openCamera();

    } catch (error) {

      console.error(
        "LOCATION:",
        error
      );

      showStatus(
        "GPS permission required."
      );

      cyberError();
    }

  }
);


/* =========================================================
   SEARCH
========================================================= */

async function searchLocation() {

  const query =
    $("searchInput")
      ?.value
      .trim();

  if (!query)
    return;

  try {

    showStatus(
      "SEARCHING LOCATION..."
    );

    const response =
      await fetch(
        "https://nominatim.openstreetmap.org/search?" +
        new URLSearchParams({
          q: query,
          format: "json",
          limit: "1"
        }),
        {
          headers: {
            Accept:
              "application/json"
          }
        }
      );

    const results =
      await response.json();

    if (!results.length) {

      showStatus(
        "LOCATION NOT FOUND."
      );

      return;
    }

    const result =
      results[0];

    const lat =
      Number(result.lat);

    const lng =
      Number(result.lon);

    map.setView(
      [lat, lng],
      15
    );

    showStatus(
      "LOCATION FOUND."
    );

    cyberSuccess();

  } catch (error) {

    console.error(
      "SEARCH:",
      error
    );

    showStatus(
      "SEARCH FAILED."
    );

  }

}


$("searchBtn")?.addEventListener(
  "click",
  searchLocation
);


$("searchInput")?.addEventListener(
  "keydown",
  event => {

    if (
      event.key === "Enter"
    ) {
      searchLocation();
    }

  }
);


/* =========================================================
   DISTANCE
========================================================= */

function distanceMeters(
  lat1,
  lon1,
  lat2,
  lon2
) {

  const R = 6371000;

  const p1 =
    lat1 * Math.PI / 180;

  const p2 =
    lat2 * Math.PI / 180;

  const dp =
    (lat2 - lat1) *
    Math.PI / 180;

  const dl =
    (lon2 - lon1) *
    Math.PI / 180;

  const a =
    Math.sin(dp / 2) ** 2 +
    Math.cos(p1) *
    Math.cos(p2) *
    Math.sin(dl / 2) ** 2;

  return (
    2 *
    R *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    )
  );
}


/* =========================================================
   SNAP LOADING
========================================================= */

async function loadSnaps() {

  try {

    const {
      data,
      error
    } =
      await supabaseClient
        .from("snaps")
        .select("*")
        .order(
          "created_at",
          {
            ascending: false
          }
        );

    if (error)
      throw error;

    snaps =
      data || [];

    setText(
      "snapCount",
      snaps.length
    );

    renderSnapMarkers();

    terminalLog(
      "SNAPS LOADED: " +
      snaps.length
    );

  } catch (error) {

    console.error(
      "SNAPS:",
      error
    );

    showStatus(
      "SNAPS LOAD FAILED."
    );

  }

}


/* =========================================================
   50M CLUSTERING
========================================================= */

function buildClusters() {

  const clusters = [];

  for (const snap of snaps) {

    let found = null;

    for (const cluster of clusters) {

      const distance =
        distanceMeters(
          Number(snap.latitude),
          Number(snap.longitude),
          cluster.latitude,
          cluster.longitude
        );

      if (distance <= 50) {

        found = cluster;
        break;
      }

    }

    if (found) {

      found.snaps.push(snap);

      const count =
        found.snaps.length;

      found.latitude =
        found.snaps.reduce(
          (sum, item) =>
            sum +
            Number(item.latitude),
          0
        ) / count;

      found.longitude =
        found.snaps.reduce(
          (sum, item) =>
            sum +
            Number(item.longitude),
          0
        ) / count;

    } else {

      clusters.push({
        latitude:
          Number(snap.latitude),

        longitude:
          Number(snap.longitude),

        snaps: [snap]
      });

    }

  }

  return clusters;
}


function renderSnapMarkers() {

  if (!map)
    return;

  snapMarkers.forEach(
    marker => {
      map.removeLayer(marker);
    }
  );

  snapMarkers = [];

  const clusters =
    buildClusters();

  for (const cluster of clusters) {

    const count =
      cluster.snaps.length;

    const html =
      `<div class="ghostMarker">
        ${count} 👻
      </div>`;

    const icon =
      L.divIcon({
        className: "",
        html,
        iconSize: [44, 44],
        iconAnchor: [22, 22]
      });

    const marker =
      L.marker(
        [
          cluster.latitude,
          cluster.longitude
        ],
        { icon }
      ).addTo(map);

    marker.on(
      "click",
      event => {

        if (
          cluster.snaps.length === 1
        ) {

          openViewer(
            cluster.snaps,
            0
          );

        } else {

          openCluster(
            cluster.snaps
          );

        }

      }
    );

    snapMarkers.push(marker);
  }

}


/* =========================================================
   CLUSTER PANEL
========================================================= */

function openCluster(
  clusterSnaps
) {

  currentClusterSnaps =
    clusterSnaps;

  setText(
    "clusterTitle",
    clusterSnaps.length +
    " SNAPS 👻"
  );

  const list =
    $("clusterSnapList");

  list.innerHTML = "";

  clusterSnaps.forEach(
    (snap, index) => {

      const item =
        document.createElement(
          "div"
        );

      item.className =
        "clusterSnapItem";

      item.innerHTML =
        `
        <div>
          SNAP ${index + 1}
        </div>
        <div style="font-size:9px;opacity:.55;margin-top:4px;">
          ${formatDate(snap.created_at)}
        </div>
        `;

      item.addEventListener(
        "click",
        () => {

          hide("clusterPanel");

          openViewer(
            clusterSnaps,
            index
          );

        }
      );

      list.appendChild(item);

    }
  );

  show("clusterPanel");
}


$("closeClusterBtn")?.addEventListener(
  "click",
  () => hide("clusterPanel")
);


/* =========================================================
   CAMERA
========================================================= */

async function openCamera() {

  try {

    stopCamera();

    const stream =
      await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode:
            currentFacingMode
        },
        audio: false
      });

    currentStream =
      stream;

    $("cameraVideo").srcObject =
      stream;

    show("cameraPanel");

    await lockCaptureGPS();

    showStatus(
      "CAMERA READY. GPS LOCKED.",
      2500
    );

  } catch (error) {

    console.error(
      "CAMERA:",
      error
    );

    showStatus(
      "CAMERA PERMISSION REQUIRED.",
      4000
    );

    cyberError();
  }

}


function stopCamera() {

  if (currentStream) {

    currentStream
      .getTracks()
      .forEach(
        track =>
          track.stop()
      );

    currentStream = null;
  }

  if ($("cameraVideo")) {
    $("cameraVideo").srcObject =
      null;
  }

}


$("closeCameraBtn")?.addEventListener(
  "click",
  () => {

    stopCamera();
    hide("cameraPanel");

  }
);


/* =========================================================
   CAMERA SWITCH
========================================================= */

$("switchCameraBtn")?.addEventListener(
  "click",
  async () => {

    currentFacingMode =
      currentFacingMode === "user"
        ? "environment"
        : "user";

    await openCamera();

  }
);


/* =========================================================
   GPS LOCK
========================================================= */

async function lockCaptureGPS() {

  try {

    const position =
      await getCurrentPosition();

    lockedGPS = {
      latitude:
        position.coords.latitude,

      longitude:
        position.coords.longitude,

      accuracy:
        position.coords.accuracy
    };

    capturedLatitude =
      lockedGPS.latitude;

    capturedLongitude =
      lockedGPS.longitude;

    const text =
      `${lockedGPS.latitude.toFixed(6)},
       ${lockedGPS.longitude.toFixed(6)}`;

    setText(
      "gpsLockIndicator",
      "GPS: LOCKED"
    );

    setText(
      "previewCoordinates",
      text
    );

    terminalLog(
      "GPS LOCKED"
    );

  } catch (error) {

    lockedGPS = null;

    setText(
      "gpsLockIndicator",
      "GPS: ERROR"
    );

    throw error;
  }

}


/* =========================================================
   PHOTO CAPTURE
========================================================= */

$("captureBtn")?.addEventListener(
  "click",
  async () => {

    if (!currentStream)
      return;

    try {

      await lockCaptureGPS();

      const video =
        $("cameraVideo");

      const canvas =
        document.createElement(
          "canvas"
        );

      canvas.width =
        video.videoWidth;

      canvas.height =
        video.videoHeight;

      const context =
        canvas.getContext(
          "2d"
        );

      if (
        currentFacingMode ===
        "user"
      ) {

        context.translate(
          canvas.width,
          0
        );

        context.scale(-1, 1);

      }

      context.drawImage(
        video,
        0,
        0,
        canvas.width,
        canvas.height
      );

      capturedBlob =
        await new Promise(
          resolve =>
            canvas.toBlob(
              resolve,
              "image/jpeg",
              .92
            )
        );

      capturedType =
        "image";

      stopCamera();

      hide("cameraPanel");

      showPreview();

      cyberSuccess();

    } catch (error) {

      console.error(
        "CAPTURE:",
        error
      );

      showStatus(
        "PHOTO CAPTURE FAILED."
      );

    }

  }
);


/* =========================================================
   VIDEO RECORDING
========================================================= */

$("recordBtn")?.addEventListener(
  "click",
  startRecording
);


$("stopRecordBtn")?.addEventListener(
  "click",
  stopRecording
);


function startRecording() {

  if (!currentStream)
    return;

  try {

    recordedChunks = [];

    mediaRecorder =
      new MediaRecorder(
        currentStream,
        {
          mimeType:
            "video/webm"
        }
      );

    mediaRecorder.ondataavailable =
      event => {

        if (
          event.data &&
          event.data.size > 0
        ) {

          recordedChunks.push(
            event.data
          );

        }

      };

    mediaRecorder.onstop =
      async () => {

        capturedBlob =
          new Blob(
            recordedChunks,
            {
              type:
                "video/webm"
            }
          );

        capturedType =
          "video";

        stopCamera();

        hide("cameraPanel");

        showPreview();

        cyberSuccess();

      };

    mediaRecorder.start();

    isRecording = true;

    show("stopRecordBtn");
    hide("recordBtn");

    showStatus(
      "VIDEO RECORDING..."
    );

  } catch (error) {

    console.error(
      "RECORD:",
      error
    );

    showStatus(
      "VIDEO RECORDING FAILED."
    );

  }

}


function stopRecording() {

  if (
    !mediaRecorder ||
    !isRecording
  )
    return;

  mediaRecorder.stop();

  isRecording = false;

  hide("stopRecordBtn");
  show("recordBtn");

}


/* =========================================================
   PREVIEW
========================================================= */

function showPreview() {

  const container =
    $("previewMedia");

  container.innerHTML = "";

  if (
    capturedType ===
    "image"
  ) {

    const image =
      document.createElement(
        "img"
      );

    image.src =
      URL.createObjectURL(
        capturedBlob
      );

    container.appendChild(
      image
    );

  } else {

    const video =
      document.createElement(
        "video"
      );

    video.src =
      URL.createObjectURL(
        capturedBlob
      );

    video.controls = true;
    video.playsInline = true;

    container.appendChild(
      video
    );

  }

  if (lockedGPS) {

    setText(
      "previewCoordinates",
      `${lockedGPS.latitude.toFixed(6)}, ${lockedGPS.longitude.toFixed(6)}`
    );

  }

  show("previewPanel");
}


$("closePreviewBtn")?.addEventListener(
  "click",
  () => {

    hide("previewPanel");

    capturedBlob = null;

  }
);


$("retakeBtn")?.addEventListener(
  "click",
  async () => {

    hide("previewPanel");

    capturedBlob = null;

    await openCamera();

  }
);


/* =========================================================
   UPLOAD SNAP
========================================================= */

async function uploadSnap() {

  if (!currentUser) {

    openAuth("login");

    return;
  }

  if (!capturedBlob) {

    showStatus(
      "NO MEDIA FOUND."
    );

    return;
  }

  if (!lockedGPS) {

    showStatus(
      "GPS LOCK REQUIRED."
    );

    cyberError();

    return;
  }

  try {

    show("loadingOverlay");

    setText(
      "loadingText",
      "VERIFYING GPS..."
    );

    /*
      Fresh GPS check before upload.
    */

    const fresh =
      await getCurrentPosition();

    const freshLat =
      fresh.coords.latitude;

    const freshLng =
      fresh.coords.longitude;

    const distance =
      distanceMeters(
        lockedGPS.latitude,
        lockedGPS.longitude,
        freshLat,
        freshLng
      );

    if (distance > 50) {

      hide("loadingOverlay");

      showStatus(
        "GPS MOVED MORE THAN 50M. POST CANCELLED.",
        5000
      );

      cyberError();

      return;
    }

    setText(
      "loadingText",
      "UPLOADING SNAP..."
    );

    const extension =
      capturedType === "image"
        ? "jpg"
        : "webm";

    const fileName =
      `${currentUser.id}/${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}.${extension}`;

    const {
      error:
        uploadError
    } =
      await supabaseClient
        .storage
        .from("past-snaps")
        .upload(
          fileName,
          capturedBlob,
          {
            contentType:
              capturedType === "image"
                ? "image/jpeg"
                : "video/webm",
            upsert: false
          }
        );

    if (uploadError)
      throw uploadError;

    const {
      data:
        publicData
    } =
      supabaseClient
        .storage
        .from("past-snaps")
        .getPublicUrl(
          fileName
        );

    const imageUrl =
      publicData.publicUrl;

    setText(
      "loadingText",
      "SAVING SNAP..."
    );

    const {
      error:
        insertError
    } =
      await supabaseClient
        .from("snaps")
        .insert({
          latitude:
            lockedGPS.latitude,

          longitude:
            lockedGPS.longitude,

          image_url:
            imageUrl,

          description:
            $("descriptionInput")
              ?.value
              ?.trim() || null,

          user_id:
            currentUser.id
        });

    if (insertError)
      throw insertError;

    hide("loadingOverlay");
    hide("previewPanel");

    capturedBlob = null;
    lockedGPS = null;

    if ($("descriptionInput"))
      $("descriptionInput").value = "";

    await loadSnaps();

    showStatus(
      "SNAP POSTED SUCCESSFULLY.",
      3500
    );

    cyberSuccess();

  } catch (error) {

    console.error(
      "POST SNAP:",
      error
    );

    hide("loadingOverlay");

    showStatus(
      "SNAP UPLOAD FAILED.",
      5000
    );

    cyberError();

  }

}


$("postSnapBtn")?.addEventListener(
  "click",
  uploadSnap
);


/* =========================================================
   VIEWER
========================================================= */

function openViewer(
  list,
  index = 0
) {

  if (!list?.length)
    return;

  currentClusterSnaps =
    list;

  currentViewerIndex =
    index;

  show("viewer");

  renderViewer();

}


function renderViewer() {

  const snap =
    currentClusterSnaps[
      currentViewerIndex
    ];

  if (!snap)
    return;

  setText(
    "viewerCounter",
    `${currentViewerIndex + 1} / ${currentClusterSnaps.length}`
  );

  setText(
    "viewerDisplayName",
    snap.display_name ||
    snap.profiles?.display_name ||
    "USER"
  );

  setText(
    "viewerLocation",
    snap.location_name ||
    `${Number(snap.latitude).toFixed(5)}, ${Number(snap.longitude).toFixed(5)}`
  );

  setText(
    "viewerDescription",
    snap.description ||
    ""
  );

  setText(
    "viewerDate",
    formatDate(
      snap.created_at
    )
  );

  setText(
    "viewerTime",
    formatTime(
      snap.created_at
    )
  );

  setText(
    "viewerViews",
    "👁 " +
    (snap.view_count || 0)
  );

  setText(
    "likeCount",
    snap.like_count || 0
  );

  setText(
    "commentCount",
    snap.comment_count || 0
  );

  const media =
    $("viewerMedia");

  media.innerHTML = "";

  const url =
    snap.image_url;

  const isVideo =
    /\.(webm|mp4|mov|m4v)(\?|$)/i.test(
      url || ""
    );

  if (isVideo) {

    const video =
      document.createElement(
        "video"
      );

    video.src = url;
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;

    media.appendChild(
      video
    );

  } else {

    const image =
      document.createElement(
        "img"
      );

    image.src = url;
    image.alt =
      "PastSnap";

    media.appendChild(
      image
    );

  }

  loadViewerSocial(
    snap
  );

  registerView(
    snap
  );
}


$("viewerCloseBtn")?.addEventListener(
  "click",
  () => hide("viewer")
);


$("viewerPrevBtn")?.addEventListener(
  "click",
  () => {

    if (
      currentViewerIndex > 0
    ) {

      currentViewerIndex--;

      renderViewer();

    }

  }
);


$("viewerNextBtn")?.addEventListener(
  "click",
  () => {

    if (
      currentViewerIndex <
      currentClusterSnaps.length - 1
    ) {

      currentViewerIndex++;

      renderViewer();

    }

  }
);


/* =========================================================
   SWIPE VIEWER
========================================================= */

let touchStartX = 0;

$("viewerContent")?.addEventListener(
  "touchstart",
  event => {

    touchStartX =
      event.touches[0].clientX;

  },
  { passive: true }
);


$("viewerContent")?.addEventListener(
  "touchend",
  event => {

    const endX =
      event.changedTouches[0].clientX;

    const difference =
      endX - touchStartX;

    if (Math.abs(difference) < 50)
      return;

    if (difference < 0) {

      $("viewerNextBtn")?.click();

    } else {

      $("viewerPrevBtn")?.click();

    }

  },
  { passive: true }
);


/* =========================================================
   VIEW COUNT
========================================================= */

async function registerView(
  snap
) {

  if (!snap?.id)
    return;

  if (
    lastSnapId ===
    snap.id
  )
    return;

  lastSnapId =
    snap.id;

  try {

    await supabaseClient
      .from("snap_views")
      .insert({
        snap_id:
          snap.id,

        user_id:
          currentUser?.id || null
      });

  } catch (error) {

    console.warn(
      "VIEW:",
      error
    );

  }

}


/* =========================================================
   LIKE
========================================================= */

async function toggleLike() {

  const snap =
    currentClusterSnaps[
      currentViewerIndex
    ];

  if (!snap?.id)
    return;

  if (!currentUser) {

    openAuth("login");

    return;
  }

  try {

    const {
      data: existing
    } =
      await supabaseClient
        .from("snap_likes")
        .select("id")
        .eq(
          "snap_id",
          snap.id
        )
        .eq(
          "user_id",
          currentUser.id
        )
        .maybeSingle();

    if (existing) {

      await supabaseClient
        .from("snap_likes")
        .delete()
        .eq(
          "id",
          existing.id
        );

    } else {

      await supabaseClient
        .from("snap_likes")
        .insert({
          snap_id:
            snap.id,

          user_id:
            currentUser.id
        });

    }

    await loadViewerSocial(
      snap
    );

  } catch (error) {

    console.error(
      "LIKE:",
      error
    );

    showStatus(
      "LIKE FAILED."
    );

  }

}


$("likeBtn")?.addEventListener(
  "click",
  toggleLike
);


/* =========================================================
   SOCIAL DATA
========================================================= */

async function loadViewerSocial(
  snap
) {

  if (!snap?.id)
    return;

  try {

    const {
      data: likes
    } =
      await supabaseClient
        .from("snap_likes")
        .select(
          "id,user_id"
        )
        .eq(
          "snap_id",
          snap.id
        );

    const count =
      likes?.length || 0;

    setText(
      "likeCount",
      count
    );

    const liked =
      currentUser &&
      likes?.some(
        like =>
          like.user_id ===
          currentUser.id
      );

    $("likeBtn")?.classList.toggle(
      "active",
      !!liked
    );

    if (likes?.length) {

      const ids =
        likes.map(
          item =>
            item.user_id
        );

      const {
        data: profiles
      } =
        await supabaseClient
          .from("profiles")
          .select(
            "id,display_name"
          )
          .in(
            "id",
            ids
          );

      const names =
        profiles?.map(
          profile =>
            profile.display_name ||
            "USER"
        ) || [];

      setText(
        "likedUsers",
        names.join(", ")
      );

    } else {

      setText(
        "likedUsers",
        ""
      );

    }

    await loadComments(
      snap.id
    );

  } catch (error) {

    console.error(
      "SOCIAL:",
      error
    );

  }

}


/* =========================================================
   COMMENTS
========================================================= */

async function loadComments(
  snapId
) {

  const list =
    $("commentsList");

  if (!list)
    return;

  list.innerHTML =
    "";

  try {

    const {
      data,
      error
    } =
      await supabaseClient
        .from("snap_comments")
        .select("*")
        .eq(
          "snap_id",
          snapId
        )
        .order(
          "created_at",
          {
            ascending: true
          }
        );

    if (error)
      throw error;

    if (!data?.length) {

      list.innerHTML =
        `<div class="emptyState">
          NO COMMENTS
        </div>`;

      setText(
        "commentCount",
        "0"
      );

      return;
    }

    setText(
      "commentCount",
      data.length
    );

    const userIds =
      [
        ...new Set(
          data
            .map(
              item =>
                item.user_id
            )
            .filter(Boolean)
        )
      ];

    let profileMap =
      {};

    if (userIds.length) {

      const {
        data: profiles
      } =
        await supabaseClient
          .from("profiles")
          .select(
            "id,display_name"
          )
          .in(
            "id",
            userIds
          );

      (profiles || [])
        .forEach(
          profile => {

            profileMap[
              profile.id
            ] =
              profile.display_name ||
              "USER";

          }
        );

    }

    data.forEach(
      comment => {

        const item =
          document.createElement(
            "div"
          );

        item.className =
          "commentItem";

        item.innerHTML =
          `
          <div class="commentAuthor">
            ${
              escapeHTML(
                profileMap[
                  comment.user_id
                ] || "USER"
              )
            }
          </div>

          <div class="commentText">
            ${
              escapeHTML(
                comment.comment_text ||
                comment.text ||
                ""
              )
            }
          </div>
          `;

        list.appendChild(
          item
        );

      }
    );

  } catch (error) {

    console.error(
      "COMMENTS:",
      error
    );

    list.innerHTML =
      `<div class="emptyState">
        COMMENTS UNAVAILABLE
      </div>`;
  }

}


$("sendCommentBtn")?.addEventListener(
  "click",
  async () => {

    if (!currentUser) {

      openAuth("login");

      return;
    }

    const text =
      $("commentInput")
        ?.value
        .trim();

    if (!text)
      return;

    const snap =
      currentClusterSnaps[
        currentViewerIndex
      ];

    if (!snap?.id)
      return;

    try {

      const {
        error
      } =
        await supabaseClient
          .from("snap_comments")
          .insert({
            snap_id:
              snap.id,

            user_id:
              currentUser.id,

            comment_text:
              text
          });

      if (error)
        throw error;

      $("commentInput").value =
        "";

      cyberMessage();

      await loadComments(
        snap.id
      );

    } catch (error) {

      console.error(
        "COMMENT:",
        error
      );

      showStatus(
        "COMMENT FAILED."
      );

    }

  }
);


/* =========================================================
   NOTIFICATIONS
========================================================= */

async function loadNotifications() {

  if (!currentUser)
    return;

  try {

    const {
      data,
      error
    } =
      await supabaseClient
        .from("notifications")
        .select("*")
        .eq(
          "user_id",
          currentUser.id
        )
        .order(
          "created_at",
          {
            ascending: false
          }
        )
        .limit(50);

    if (error)
      throw error;

    renderNotifications(
      data || []
    );

  } catch (error) {

    console.error(
      "NOTIFICATIONS:",
      error
    );

  }

}


function renderNotifications(
  notifications
) {

  const list =
    $("notificationList");

  if (!list)
    return;

  list.innerHTML =
    "";

  if (!notifications.length) {

    list.innerHTML =
      `<div class="emptyState">
        NO NEW NOTIFICATIONS
      </div>`;

    setText(
      "notificationCount",
      ""
    );

    return;
  }

  setText(
    "notificationCount",
    notifications.length
  );

  notifications.forEach(
    notification => {

      const item =
        document.createElement(
          "div"
        );

      item.className =
        "notificationItem";

      item.innerHTML =
        `
        <div>
          ${
            escapeHTML(
              notification.message ||
              notification.notification_type ||
              "NEW NOTIFICATION"
            )
          }
        </div>

        <div style="opacity:.4;margin-top:5px;font-size:8px;">
          ${
            formatDate(
              notification.created_at
            )
          }
        </div>
        `;

      item.addEventListener(
        "click",
        async () => {

          if (
            notification.snap_id
          ) {

            const index =
              snaps.findIndex(
                snap =>
                  String(snap.id) ===
                  String(
                    notification.snap_id
                  )
              );

            if (index >= 0) {

              openViewer(
                [snaps[index]],
                0
              );

              hide(
                "notificationPanel"
              );

            }

          }

        }
      );

      list.appendChild(
        item
      );

    }
  );

}


$("notificationBtn")?.addEventListener(
  "click",
  async () => {

    if (!currentUser) {

      openAuth("login");

      return;
    }

    await loadNotifications();

    show(
      "notificationPanel"
    );

  }
);


$("closeNotificationBtn")?.addEventListener(
  "click",
  () =>
    hide(
      "notificationPanel"
    )
);


/* =========================================================
   CALL PANEL
========================================================= */

$("myRoomBtn")?.addEventListener(
  "click",
  async () => {

    if (!currentUser) {

      openAuth("login");

      return;
    }

    const panel =
      $("callPanel");

    if (
      panel.style.display ===
      "block"
    ) {

      panel.style.display =
        "none";

      return;
    }

    const room =
      await createMyRoom();

    if (!room)
      return;

    setText(
      "myCallId",
      room
    );

    panel.style.display =
      "block";

  }
);


$("closeCallPanelBtn")?.addEventListener(
  "click",
  () => {

    $("callPanel").style.display =
      "none";

  }
);


$("copyCallIdBtn")?.addEventListener(
  "click",
  async () => {

    if (!myRoom)
      return;

    try {

      await navigator.clipboard.writeText(
        myRoom
      );

      showStatus(
        "CALL ID COPIED."
      );

      cyberSuccess();

    } catch (error) {

      showStatus(
        "COPY FAILED."
      );

    }

  }
);


/* =========================================================
   CALL USER
========================================================= */

$("callUserBtn")?.addEventListener(
  "click",
  async () => {

    if (!currentUser) {

      openAuth("login");

      return;
    }

    const target =
      $("targetCallId")
        ?.value
        .trim()
        .toUpperCase();

    if (
      !target ||
      target.length !== 6
    ) {

      showStatus(
        "ENTER VALID 6-CHAR CALL ID."
      );

      cyberError();

      return;
    }

    if (
      target === myRoom
    ) {

      showStatus(
        "YOU CANNOT CALL YOURSELF."
      );

      return;
    }

    await joinOwnCallRoom();

    chatTargetRoom =
      target;

    socket.emit(
      "call-user",
      {
        targetRoom:
          target,

        callerRoom:
          myRoom
      }
    );

    showStatus(
      "CALLING " +
      target +
      "..."
    );

    cyberCall();

  }
);


/* =========================================================
   SOCKET — ROOM
========================================================= */

socket.on(
  "connect",
  async () => {

    terminalLog(
      "SOCKET CONNECTED"
    );

    if (currentUser) {

      setTimeout(
        () => {
          joinOwnCallRoom();
        },
        300
      );

    }

  }
);


socket.on(
  "disconnect",
  () => {

    terminalLog(
      "SOCKET DISCONNECTED"
    );

  }
);


socket.on(
  "room-joined",
  data => {

    if (data?.roomId) {

      myRoom =
        data.roomId;

      setText(
        "myCallId",
        myRoom
      );

      setText(
        "profileCallRoom",
        myRoom
      );

    }

  }
);


/* =========================================================
   INCOMING CALL
========================================================= */

socket.on(
  "incoming-call",
  data => {

    incomingCallerId =
      data.callerId;

    incomingCallerRoom =
      data.callerRoom ||
      data.targetRoom ||
      "";

    setText(
      "incomingCallerText",
      "CALL FROM " +
      (
        incomingCallerRoom ||
        "UNKNOWN"
      )
    );

    setText(
      "incomingCallerRoom",
      "ROOM " +
      (
        incomingCallerRoom ||
        "------"
      )
    );

    show(
      "incomingCallOverlay"
    );

    cyberCall();

    terminalLog(
      "INCOMING CALL"
    );

  }
);


/* =========================================================
   ACCEPT CALL
========================================================= */

$("acceptCallBtn")?.addEventListener(
  "click",
  async () => {

    if (!incomingCallerId)
      return;

    try {

      await openCallMedia();

      socket.emit(
        "accept-call",
        {
          callerId:
            incomingCallerId
        }
      );

      activePeerId =
        incomingCallerId;

      hide(
        "incomingCallOverlay"
      );

      await startPeerConnection(
        incomingCallerId,
        false
      );

      activeCall = true;

      show(
        "activeCallOverlay"
      );

      cyberSuccess();

    } catch (error) {

      console.error(
        "ACCEPT:",
        error
      );

      showStatus(
        "CALL MEDIA FAILED."
      );

    }

  }
);


/* =========================================================
   REJECT CALL
========================================================= */

$("rejectCallBtn")?.addEventListener(
  "click",
  () => {

    if (incomingCallerId) {

      socket.emit(
        "reject-call",
        {
          callerId:
            incomingCallerId
        }
      );

    }

    incomingCallerId =
      null;

    hide(
      "incomingCallOverlay"
    );

    showStatus(
      "CALL REJECTED."
    );

  }
);


/* =========================================================
   CALL ACCEPTED
========================================================= */

socket.on(
  "call-accepted",
  async data => {

    activePeerId =
      data.accepterId;

    try {

      await openCallMedia();

      show(
        "activeCallOverlay"
      );

      activeCall = true;

      await startPeerConnection(
        activePeerId,
        true
      );

      showStatus(
        "CALL CONNECTED."
      );

      cyberSuccess();

    } catch (error) {

      console.error(
        "CALL ACCEPTED:",
        error
      );

      showStatus(
        "CALL CONNECTION FAILED."
      );

    }

  }
);


/* =========================================================
   CALL REJECTED
========================================================= */

socket.on(
  "call-rejected",
  () => {

    showStatus(
      "CALL REJECTED."
    );

    cyberError();

  }
);


/* =========================================================
   CALL UNAVAILABLE
========================================================= */

socket.on(
  "call-unavailable",
  data => {

    showStatus(
      "USER " +
      (
        data?.roomId ||
        ""
      ) +
      " IS OFFLINE."
    );

    cyberError();

  }
);


/* =========================================================
   CALL RINGING
========================================================= */

socket.on(
  "call-ringing",
  data => {

    showStatus(
      "CALL RINGING " +
      (
        data?.roomId ||
        ""
      ) +
      "..."
    );

  }
);


/* =========================================================
   WEBRTC MEDIA
========================================================= */

async function openCallMedia() {

  if (localCallStream)
    return localCallStream;

  localCallStream =
    await navigator.mediaDevices
      .getUserMedia({
        video: true,
        audio: true
      });

  const localVideo =
    $("localVideo");

  if (localVideo) {

    localVideo.srcObject =
      localCallStream;

    localVideo.muted =
      true;

    localVideo.playsInline =
      true;

  }

  return localCallStream;
}


/* =========================================================
   PEER CONNECTION
========================================================= */

function createPeerConnection(
  targetId
) {

  const pc =
    new RTCPeerConnection({
      iceServers: [
        {
          urls:
            "stun:stun.l.google.com:19302"
        }
      ]
    });

  pc.onicecandidate =
    event => {

      if (
        event.candidate
      ) {

        socket.emit(
          "webrtc-signal",
          {
            targetId,

            signal: {
              type:
                "candidate",

              candidate:
                event.candidate
            }
          }
        );

      }

    };


  pc.ontrack =
    event => {

      const remoteVideo =
        $("remoteVideo");

      if (!remoteVideo)
        return;

      if (
        remoteVideo.srcObject !==
        event.streams[0]
      ) {

        remoteVideo.srcObject =
          event.streams[0];

      }

      setText(
        "remoteCallStatus",
        "CONNECTED"
      );

    };


  pc.onconnectionstatechange =
    () => {

      const state =
        pc.connectionState;

      setText(
        "remoteCallStatus",
        state.toUpperCase()
      );

      if (
        state === "connected"
      ) {

        show(
          "activeCallOverlay"
        );

      }

      if (
        state === "failed" ||
        state === "disconnected" ||
        state === "closed"
      ) {

        endCall(false);

      }

    };

  return pc;
}


async function startPeerConnection(
  targetId,
  createOffer
) {

  await openCallMedia();

  peerConnection =
    createPeerConnection(
      targetId
    );

  localCallStream
    .getTracks()
    .forEach(
      track => {

        peerConnection.addTrack(
          track,
          localCallStream
        );

      }
    );

  if (createOffer) {

    const offer =
      await peerConnection
        .createOffer();

    await peerConnection
      .setLocalDescription(
        offer
      );

    socket.emit(
      "webrtc-signal",
      {
        targetId,

        signal: {
          type:
            "offer",

          sdp:
            offer.sdp
        }
      }
    );

  }

}


/* =========================================================
   WEBRTC SIGNAL
========================================================= */

socket.on(
  "webrtc-signal",
  async data => {

    if (!data?.senderId ||
        !data?.signal)
      return;

    try {

      const signal =
        data.signal;

      if (
        !peerConnection
      ) {

        await openCallMedia();

        activePeerId =
          data.senderId;

        peerConnection =
          createPeerConnection(
            data.senderId
          );

        localCallStream
          .getTracks()
          .forEach(
            track => {

              peerConnection.addTrack(
                track,
                localCallStream
              );

            }
          );

        activeCall = true;

        show(
          "activeCallOverlay"
        );

      }

      if (
        signal.type ===
        "offer"
      ) {

        await peerConnection
          .setRemoteDescription(
            {
              type:
                "offer",

              sdp:
                signal.sdp
            }
          );

        const answer =
          await peerConnection
            .createAnswer();

        await peerConnection
          .setLocalDescription(
            answer
          );

        socket.emit(
          "webrtc-signal",
          {
            targetId:
              data.senderId,

            signal: {
              type:
                "answer",

              sdp:
                answer.sdp
            }
          }
        );

      }

      else if (
        signal.type ===
        "answer"
      ) {

        await peerConnection
          .setRemoteDescription(
            {
              type:
                "answer",

              sdp:
                signal.sdp
            }
          );

      }

      else if (
        signal.type ===
        "candidate"
      ) {

        if (
          signal.candidate
        ) {

          await peerConnection
            .addIceCandidate(
              signal.candidate
            );

        }

      }

    } catch (error) {

      console.error(
        "WEBRTC SIGNAL:",
        error
      );

    }

  }
);


/* =========================================================
   MIC
========================================================= */

$("micBtn")?.addEventListener(
  "click",
  () => {

    if (!localCallStream)
      return;

    micEnabled =
      !micEnabled;

    localCallStream
      .getAudioTracks()
      .forEach(
        track => {
          track.enabled =
            micEnabled;
        }
      );

    $("micBtn").textContent =
      micEnabled
        ? "🎙️"
        : "🔇";

    showStatus(
      micEnabled
        ? "MIC ON"
        : "MIC MUTED"
    );

  }
);


/* =========================================================
   CAMERA DURING CALL
========================================================= */

$("cameraBtn")?.addEventListener(
  "click",
  () => {

    if (!localCallStream)
      return;

    cameraEnabled =
      !cameraEnabled;

    localCallStream
      .getVideoTracks()
      .forEach(
        track => {
          track.enabled =
            cameraEnabled;
        }
      );

    $("cameraBtn").textContent =
      cameraEnabled
        ? "📷"
        : "🚫";

    showStatus(
      cameraEnabled
        ? "CAMERA ON"
        : "CAMERA OFF"
    );

  }
);


/* =========================================================
   END CALL
========================================================= */

$("endBtn")?.addEventListener(
  "click",
  () => endCall(true)
);


function endCall(
  notifyRemote = true
) {

  if (
    notifyRemote &&
    activePeerId
  ) {

    socket.emit(
      "end-call",
      {
        targetId:
          activePeerId
      }
    );

  }

  if (peerConnection) {

    try {
      peerConnection.close();
    } catch (e) {}

    peerConnection = null;
  }

  if (localCallStream) {

    localCallStream
      .getTracks()
      .forEach(
        track =>
          track.stop()
      );

    localCallStream = null;
  }

  const localVideo =
    $("localVideo");

  const remoteVideo =
    $("remoteVideo");

  if (localVideo)
    localVideo.srcObject =
      null;

  if (remoteVideo)
    remoteVideo.srcObject =
      null;

  activePeerId = null;

  activeCall = false;

  micEnabled = true;
  cameraEnabled = true;

  if ($("micBtn"))
    $("micBtn").textContent =
      "🎙️";

  if ($("cameraBtn"))
    $("cameraBtn").textContent =
      "📷";

  hide(
    "activeCallOverlay"
  );

  showStatus(
    "CALL ENDED."
  );

}


socket.on(
  "call-ended",
  () => {

    endCall(false);

    cyberTone(
      220,
      0.12,
      "sawtooth"
    );

  }
);


/* =========================================================
   CHAT
========================================================= */

function addChatMessage(
  message,
  mine = false
) {

  const container =
    $("chatMessages");

  if (!container)
    return;

  const item =
    document.createElement(
      "div"
    );

  item.className =
    "chatMessage " +
    (
      mine
        ? "mine"
        : "other"
    );

  item.textContent =
    message;

  container.appendChild(
    item
  );

  container.scrollTop =
    container.scrollHeight;

}


$("sendChatBtn")?.addEventListener(
  "click",
  sendChatMessage
);


$("chatInput")?.addEventListener(
  "keydown",
  event => {

    if (
      event.key === "Enter" &&
      !event.shiftKey
    ) {

      event.preventDefault();

      sendChatMessage();

    }

  }
);


function sendChatMessage() {

  const input =
    $("chatInput");

  const message =
    input?.value.trim();

  if (!message)
    return;

  /*
    The Socket.IO server must relay
    chat-message for real-time chat.
  */

  socket.emit(
    "chat-message",
    {
      targetRoom:
        chatTargetRoom ||
        myRoom,

      message
    }
  );

  addChatMessage(
    message,
    true
  );

  input.value =
    "";

  cyberMessage();

}


socket.on(
  "chat-message",
  data => {

    if (!data?.message)
      return;

    addChatMessage(
      data.message,
      false
    );

    show(
      "chatPanel"
    );

    cyberMessage();

  }
);


/* =========================================================
   MOBILE NAV
========================================================= */

$("bottomMapBtn")?.addEventListener(
  "click",
  () => {

    hide("cameraPanel");
    hide("chatPanel");
    hide("profilePanel");

    setBottomActive(
      "bottomMapBtn"
    );

  }
);


$("bottomCameraBtn")?.addEventListener(
  "click",
  async () => {

    if (!currentUser) {

      openAuth("login");

      return;
    }

    setBottomActive(
      "bottomCameraBtn"
    );

    await openCamera();

  }
);


$("bottomCallBtn")?.addEventListener(
  "click",
  async () => {

    if (!currentUser) {

      openAuth("login");

      return;
    }

    setBottomActive(
      "bottomCallBtn"
    );

    const panel =
      $("callPanel");

    panel.style.display =
      panel.style.display ===
      "block"
        ? "none"
        : "block";

    await createMyRoom();

  }
);


$("bottomChatBtn")?.addEventListener(
  "click",
  () => {

    if (!currentUser) {

      openAuth("login");

      return;
    }

    setBottomActive(
      "bottomChatBtn"
    );

    show("chatPanel");

  }
);


$("bottomAccountBtn")?.addEventListener(
  "click",
  () => {

    if (!currentUser) {

      openAuth("login");

      return;
    }

    setBottomActive(
      "bottomAccountBtn"
    );

    show("profilePanel");

  }
);


$("closeChatBtn")?.addEventListener(
  "click",
  () =>
    hide("chatPanel")
);


function setBottomActive(
  id
) {

  document
    .querySelectorAll(
      ".bottomNavBtn"
    )
    .forEach(
      button =>
        button.classList.remove(
          "active"
        )
    );

  $(id)?.classList.add(
    "active"
  );

}


/* =========================================================
   PHOTO / VIDEO MODE
========================================================= */

$("photoModeBtn")?.addEventListener(
  "click",
  () => {

    $("photoModeBtn")
      ?.classList.add(
        "active"
      );

    $("videoModeBtn")
      ?.classList.remove(
        "active"
      );

    show("captureBtn");
    hide("recordBtn");
    hide("stopRecordBtn");

  }
);


$("videoModeBtn")?.addEventListener(
  "click",
  () => {

    $("videoModeBtn")
      ?.classList.add(
        "active"
      );

    $("photoModeBtn")
      ?.classList.remove(
        "active"
      );

    hide("captureBtn");
    show("recordBtn");

  }
);


/* =========================================================
   ESCAPE KEY
========================================================= */

document.addEventListener(
  "keydown",
  event => {

    if (
      event.key !== "Escape"
    )
      return;

    hide("viewer");
    hide("cameraPanel");
    hide("previewPanel");
    hide("notificationPanel");
    hide("clusterPanel");
    hide("profilePanel");
    hide("chatPanel");

    if ($("callPanel"))
      $("callPanel").style.display =
        "none";

  }
);


/* =========================================================
   HTML ESCAPE
========================================================= */

function escapeHTML(
  value
) {

  return String(
    value ?? ""
  )
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&#039;"
    );

}


/* =========================================================
   DATE / TIME
========================================================= */

function formatDate(
  value
) {

  if (!value)
    return "";

  const date =
    new Date(value);

  return date.toLocaleDateString(
    "en-IN",
    {
      day: "2-digit",
      month: "short",
      year: "numeric"
    }
  );

}


function formatTime(
  value
) {

  if (!value)
    return "";

  const date =
    new Date(value);

  return date.toLocaleTimeString(
    "en-IN",
    {
      hour: "2-digit",
      minute: "2-digit"
    }
  );

}


/* =========================================================
   CLEANUP
========================================================= */

window.addEventListener(
  "beforeunload",
  () => {

    stopCamera();

    if (gpsWatchId !== null) {

      navigator.geolocation
        ?.clearWatch(
          gpsWatchId
        );

    }

    if (localCallStream) {

      localCallStream
        .getTracks()
        .forEach(
          track =>
            track.stop()
        );

    }

  }
);


/* =========================================================
   STARTUP
========================================================= */

async function boot() {

  terminalLog(
    "PASTSNAP BOOTING..."
  );

  initMap();

  startGPS();

  await restoreSession();

  await loadSnaps();

  updateAccountUI();

  setText(
    "status",
    "SYSTEM READY..."
  );

  terminalLog(
    "ALL SYSTEMS READY"
  );

}


boot().catch(
  error => {

    console.error(
      "BOOT ERROR:",
      error
    );

    showStatus(
      "SYSTEM INITIALIZATION ERROR.",
      5000
    );

  }
);
