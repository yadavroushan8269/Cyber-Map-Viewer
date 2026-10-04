// ============================================
// GLOBAL
// ============================================

let token = localStorage.getItem("authToken");

let selectedColour = null;
let playing = false;
let time = 30;
let timerInterval = null;


// ============================================
// ELEMENTS
// ============================================

const authScreen =
  document.getElementById("authScreen");

const app =
  document.getElementById("app");

const loginBox =
  document.getElementById("loginBox");

const registerBox =
  document.getElementById("registerBox");

const loginForm =
  document.getElementById("loginForm");

const registerForm =
  document.getElementById("registerForm");

const showRegister =
  document.getElementById("showRegister");

const showLogin =
  document.getElementById("showLogin");

const loginMessage =
  document.getElementById("loginMessage");

const registerMessage =
  document.getElementById("registerMessage");

const balance =
  document.getElementById("balance");

const username =
  document.getElementById("username");

const round =
  document.getElementById("round");

const timer =
  document.getElementById("timer");

const selected =
  document.getElementById("selected");

const playBtn =
  document.getElementById("playBtn");

const historyBox =
  document.getElementById("history");

const logoutBtn =
  document.getElementById("logoutBtn");

const colourButtons =
  document.querySelectorAll(".colour");


// ============================================
// AUTH SCREEN
// ============================================

showRegister.addEventListener("click", () => {

  loginBox.classList.add("hidden");
  registerBox.classList.remove("hidden");

  loginMessage.textContent = "";
  registerMessage.textContent = "";

});


showLogin.addEventListener("click", () => {

  registerBox.classList.add("hidden");
  loginBox.classList.remove("hidden");

  loginMessage.textContent = "";
  registerMessage.textContent = "";

});


// ============================================
// REGISTER
// ============================================

registerForm.addEventListener("submit", async (event) => {

  event.preventDefault();

  const usernameValue =
    document
      .getElementById("registerUsername")
      .value
      .trim();

  const password =
    document
      .getElementById("registerPassword")
      .value;

  const confirm =
    document
      .getElementById("registerConfirm")
      .value;

  registerMessage.textContent = "";

  if (password !== confirm) {

    registerMessage.textContent =
      "Passwords do not match.";

    return;
  }

  try {

    const response = await fetch(
      "/api/register",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          username: usernameValue,
          password
        })
      }
    );

    const data = await response.json();

    if (!data.success) {

      registerMessage.textContent =
        data.message || "Registration failed.";

      return;
    }

    token = data.token;

    localStorage.setItem(
      "authToken",
      token
    );

    showApp(data.user);

  } catch (error) {

    registerMessage.textContent =
      "Server error. Please try again.";

    console.error(error);
  }

});


// ============================================
// LOGIN
// ============================================

loginForm.addEventListener("submit", async (event) => {

  event.preventDefault();

  const usernameValue =
    document
      .getElementById("loginUsername")
      .value
      .trim();

  const password =
    document
      .getElementById("loginPassword")
      .value;

  loginMessage.textContent = "";

  try {

    const response = await fetch(
      "/api/login",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          username: usernameValue,
          password
        })
      }
    );

    const data = await response.json();

    if (!data.success) {

      loginMessage.textContent =
        data.message || "Login failed.";

      return;
    }

    token = data.token;

    localStorage.setItem(
      "authToken",
      token
    );

    showApp(data.user);

  } catch (error) {

    loginMessage.textContent =
      "Server error. Please try again.";

    console.error(error);
  }

});


// ============================================
// SHOW APP
// ============================================

function showApp(user) {

  authScreen.classList.add("hidden");

  app.classList.remove("hidden");

  username.textContent =
    user.username;

  updateUserData(user);

  startTimer();
}


// ============================================
// USER DATA
// ============================================

function updateUserData(user) {

  balance.textContent =
    Number(user.points).toLocaleString();

  round.textContent =
    user.round;

  renderHistory(
    user.history || []
  );
}


// ============================================
// CHECK LOGIN
// ============================================

async function checkLogin() {

  if (!token) {

    showLoginScreen();

    return;
  }

  try {

    const response = await fetch(
      "/api/me",
      {
        headers: {
          Authorization:
            "Bearer " + token
        }
      }
    );

    if (!response.ok) {

      throw new Error("Session expired");
    }

    const data =
      await response.json();

    showApp(data.user);

  } catch (error) {

    localStorage.removeItem("authToken");

    token = null;

    showLoginScreen();
  }
}


function showLoginScreen() {

  authScreen.classList.remove("hidden");

  app.classList.add("hidden");
}


// ============================================
// COLOUR SELECTION
// ============================================

colourButtons.forEach(button => {

  button.addEventListener("click", () => {

    if (playing) return;

    colourButtons.forEach(item => {
      item.classList.remove(
        "selected-colour"
      );
    });

    button.classList.add(
      "selected-colour"
    );

    selectedColour =
      button.dataset.colour;

    selected.textContent =
      "Selected: " + selectedColour;
  });

});


// ============================================
// PLAY
// ============================================

playBtn.addEventListener(
  "click",
  playRound
);


async function playRound() {

  if (playing) return;

  if (!selectedColour) {

    alert(
      "Please select a colour first."
    );

    return;
  }

  playing = true;

  playBtn.disabled = true;

  colourButtons.forEach(button => {
    button.disabled = true;
  });

  try {

    const response = await fetch(
      "/api/play",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          Authorization:
            "Bearer " + token
        },

        body: JSON.stringify({
          colour: selectedColour
        })
      }
    );

    const data =
      await response.json();

    if (!response.ok) {

      alert(
        data.message ||
        "Something went wrong."
      );

      return;
    }

    if (data.correct) {

      alert(
        "Correct colour! +100 points"
      );

    } else {

      alert(
        "Result: " + data.result
      );
    }

    updateUserData({
      username,
      points: data.points,
      round: data.round,
      history: data.history
    });

    selectedColour = null;

    selected.textContent =
      "No colour selected";

    colourButtons.forEach(button => {
      button.classList.remove(
        "selected-colour"
      );
    });

    time = 30;

  } catch (error) {

    console.error(error);

    alert(
      "Server error. Please try again."
    );

  } finally {

    playing = false;

    playBtn.disabled = false;

    colourButtons.forEach(button => {
      button.disabled = false;
    });
  }
}


// ============================================
// HISTORY
// ============================================

function renderHistory(history) {

  historyBox.innerHTML = "";

  if (!history.length) {

    historyBox.innerHTML =
      '<span style="color:#999;font-size:13px;">No results yet.</span>';

    return;
  }

  history.forEach(item => {

    const div =
      document.createElement("div");

    div.className =
      "result " +
      item.result +
      (item.correct ? " win" : "");

    div.textContent =
      "#" +
      item.round +
      " " +
      item.result;

    historyBox.appendChild(div);

  });
}


// ============================================
// TIMER
// ============================================

function startTimer() {

  if (timerInterval) {
    clearInterval(timerInterval);
  }

  timerInterval = setInterval(() => {

    if (time > 0) {

      time--;

    } else {

      time = 30;
    }

    timer.textContent = time;

  }, 1000);
}


// ============================================
// LOGOUT
// ============================================

logoutBtn.addEventListener(
  "click",
  async () => {

    try {

      await fetch(
        "/api/logout",
        {
          method: "POST",

          headers: {
            Authorization:
              "Bearer " + token
          }
        }
      );

    } catch (error) {
      console.log(error);
    }

    localStorage.removeItem(
      "authToken"
    );

    token = null;

    if (timerInterval) {
      clearInterval(timerInterval);
    }

    location.reload();

  }
);


// ============================================
// START
// ============================================

checkLogin();
