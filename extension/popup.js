const usedCountEl = document.getElementById("usedCount");
const remainingCountEl = document.getElementById("remainingCount");
const progressBarEl = document.getElementById("progressBar");
const subscriptionTextEl = document.getElementById("subscriptionText");
const statusNoteEl = document.getElementById("statusNote");
const planPillEl = document.getElementById("planPill");
const upgradeLinkEl = document.getElementById("upgradeLink");
const accountTextEl = document.getElementById("accountText");
const loginBtnEl = document.getElementById("loginBtn");
const logoutBtnEl = document.getElementById("logoutBtn");

init();

async function init() {
  loginBtnEl.addEventListener("click", onLoginClick);
  logoutBtnEl.addEventListener("click", onLogoutClick);

  await refreshUsage();

  upgradeLinkEl.addEventListener("click", (event) => {
    event.preventDefault();
    chrome.tabs.create({ url: "https://your-app.vercel.app" });
  });
}

async function refreshUsage() {
  const result = await chrome.runtime.sendMessage({ type: "GET_USAGE" });

  if (!result || !result.ok || !result.usage) {
    statusNoteEl.textContent = "Unable to load usage right now.";
    return;
  }

  renderAccount(result.auth || null, result.user || null);
  render(result.usage, result.user || null);
}

function render(usage, user) {
  const used = usage.used || 0;
  const limit = usage.limit || 20;
  const remaining = Math.max(0, usage.remaining ?? (limit - used));
  const percent = Math.min(100, Math.round((used / limit) * 100));

  usedCountEl.textContent = String(used);
  remainingCountEl.textContent = String(remaining);
  progressBarEl.style.width = `${percent}%`;

  planPillEl.textContent = "Free";
  subscriptionTextEl.textContent = "Free tier: 20 compressions/day";

  if (remaining <= 0) {
    statusNoteEl.textContent = "Daily limit reached. Sign in to sync usage across devices.";
    upgradeLinkEl.textContent = "Open Dashboard";
    progressBarEl.dataset.state = "danger";
  } else if (remaining <= 5) {
    statusNoteEl.textContent = "Running low today. Use compressions carefully.";
    upgradeLinkEl.textContent = "Open Dashboard";
    progressBarEl.dataset.state = "warn";
  } else {
    statusNoteEl.textContent = "You are in a healthy range.";
    upgradeLinkEl.textContent = "Open Dashboard";
    progressBarEl.dataset.state = "good";
  }

  if (user?.email) {
    statusNoteEl.textContent = `${statusNoteEl.textContent} Signed in as ${user.email}.`;
  }
}

function renderAccount(auth, user) {
  if (auth?.user?.email || user?.email) {
    accountTextEl.textContent = `Signed in: ${auth?.user?.email || user?.email}`;
    loginBtnEl.style.display = "none";
    logoutBtnEl.style.display = "inline-block";
    return;
  }

  accountTextEl.textContent = "Not signed in (anonymous mode)";
  loginBtnEl.style.display = "inline-block";
  logoutBtnEl.style.display = "none";
}

async function onLoginClick() {
  const result = await chrome.runtime.sendMessage({ type: "LOGIN" });
  if (!result?.ok) {
    statusNoteEl.textContent = result?.error || "Login failed. Check Supabase config.";
    return;
  }

  await refreshUsage();
}

async function onLogoutClick() {
  await chrome.runtime.sendMessage({ type: "LOGOUT" });
  await refreshUsage();
}
