let balance = Number(localStorage.getItem("points")) || 10000;
let round = Number(localStorage.getItem("round")) || 1001;

let selectedColour = null;
let time = 30;
let playing = false;

const colours = ["Red", "Green", "Purple"];

function updateBalance() {
  document.getElementById("balance").textContent =
    balance.toLocaleString();

  localStorage.setItem("points", balance);
}

function updateRound() {
  document.getElementById("round").textContent = round;
}

function selectColour(colour) {

  if (playing) return;

  selectedColour = colour;

  document.getElementById("selected").textContent =
    "Selected: " + colour;
}

function playRound() {

  if (playing) return;

  if (!selectedColour) {
    alert("Please select a colour first.");
    return;
  }

  playing = true;

  const result =
    colours[Math.floor(Math.random() * colours.length)];

  setTimeout(() => {

    addHistory(result);

    if (result === selectedColour) {
      balance += 100;
      alert("Correct colour! +100 points");
    } else {
      alert("Result: " + result);
    }

    updateBalance();

    round++;

    updateRound();

    selectedColour = null;

    document.getElementById("selected").textContent =
      "No colour selected";

    playing = false;

    time = 30;

  }, 1000);
}

function addHistory(result) {

  const history =
    JSON.parse(localStorage.getItem("history") || "[]");

  history.unshift({
    round,
    result,
    time: new Date().toLocaleTimeString()
  });

  history.splice(20);

  localStorage.setItem(
    "history",
    JSON.stringify(history)
  );

  renderHistory();
}

function renderHistory() {

  const box = document.getElementById("history");

  if (!box) return;

  const history =
    JSON.parse(localStorage.getItem("history") || "[]");

  box.innerHTML = "";

  history.forEach(item => {

    const div = document.createElement("div");

    div.className =
      "result " + item.result;

    div.textContent =
      "#" + item.round + " " + item.result;

    box.appendChild(div);

  });
}

function countdown() {

  if (time > 0) {
    time--;
  } else {
    time = 30;
  }

  document.getElementById("timer").textContent =
    time;
}

updateBalance();
updateRound();
renderHistory();

setInterval(countdown, 1000);
