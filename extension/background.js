const DAILY_LIMIT = 20;
const USAGE_KEY = "tokensaver_usage";
const SESSION_KEY = "tokensaver_session";

const API_BASE = "https://your-app.vercel.app";
const SUPABASE_URL = "https://your-project.supabase.co";
const SUPABASE_ANON_KEY = "your_supabase_anon_key";

function getTodayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

async function readUsageState() {
  const stored = await chrome.storage.local.get(USAGE_KEY);
  const current = stored[USAGE_KEY];
  const today = getTodayIsoDate();

  if (!current || current.date !== today) {
    const fresh = {
      date: today,
      used: 0,
      limit: DAILY_LIMIT,
      tier: "free"
    };
    await chrome.storage.local.set({ [USAGE_KEY]: fresh });
    return fresh;
  }

  const normalized = {
    date: current.date,
    used: Number.isFinite(current.used) ? current.used : 0,
    limit: Number.isFinite(current.limit) ? current.limit : DAILY_LIMIT,
    tier: current.tier || "free"
  };

  if (
    normalized.used !== current.used ||
    normalized.limit !== current.limit ||
    normalized.tier !== current.tier
  ) {
    await chrome.storage.local.set({ [USAGE_KEY]: normalized });
  }

  return normalized;
}

function toUsageResponse(state) {
  const remaining = Math.max(0, state.limit - state.used);
  return {
    date: state.date,
    used: state.used,
    limit: state.limit,
    remaining,
    tier: state.tier,
    isExhausted: remaining <= 0
  };
}

async function getUsageResponse() {
  const state = await readUsageState();
  return toUsageResponse(state);
}

async function consumeCompression() {
  const state = await readUsageState();
  if (state.used >= state.limit) {
    return toUsageResponse(state);
  }

  const next = { ...state, used: state.used + 1 };
  await chrome.storage.local.set({ [USAGE_KEY]: next });
  const usage = toUsageResponse(next);
  await broadcastUsage(usage);
  return usage;
}

async function broadcastUsage(usage) {
  try {
    await chrome.runtime.sendMessage({ type: "USAGE_UPDATED", payload: usage });
  } catch (_) {
    // No listeners is normal when popup/content are not open.
  }
}

async function getStoredSession() {
  const stored = await chrome.storage.local.get(SESSION_KEY);
  return stored[SESSION_KEY] || null;
}

async function setStoredSession(session) {
  await chrome.storage.local.set({ [SESSION_KEY]: session });
  await broadcastAuth(session);
}

async function clearStoredSession() {
  await chrome.storage.local.remove(SESSION_KEY);
  await broadcastAuth(null);
}

async function broadcastAuth(session) {
  try {
    await chrome.runtime.sendMessage({ type: "AUTH_UPDATED", payload: session });
  } catch (_) {
    // Ignore when no active listeners.
  }
}

function parseHashParams(url) {
  const parsed = new URL(url);
  const hash = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash;
  return new URLSearchParams(hash);
}

async function loginWithGoogleOAuth() {
  const redirectUri = chrome.identity.getRedirectURL("supabase-auth");
  const authUrl =
    `${SUPABASE_URL}/auth/v1/authorize` +
    `?provider=google` +
    `&redirect_to=${encodeURIComponent(redirectUri)}` +
    `&response_type=token` +
    `&scope=${encodeURIComponent("email profile")}`;

  const callbackUrl = await chrome.identity.launchWebAuthFlow({
    url: authUrl,
    interactive: true
  });

  if (!callbackUrl) {
    throw new Error("OAuth login cancelled or failed");
  }

  const params = parseHashParams(callbackUrl);
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  const expiresIn = Number(params.get("expires_in") || "0");

  if (!accessToken || !refreshToken || !expiresIn) {
    throw new Error("OAuth callback missing tokens");
  }

  const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!userResp.ok) {
    throw new Error("Failed to fetch user profile from Supabase");
  }

  const user = await userResp.json();
  const session = {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    user: {
      id: user.id,
      email: user.email
    }
  };

  await setStoredSession(session);
  return session;
}

async function refreshSessionIfNeeded(current) {
  if (!current) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if ((current.expires_at || 0) - now > 60) {
    return current;
  }

  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY
    },
    body: JSON.stringify({ refresh_token: current.refresh_token })
  });

  if (!response.ok) {
    await clearStoredSession();
    return null;
  }

  const data = await response.json();
  const next = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || current.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600),
    user: current.user
  };

  await setStoredSession(next);
  return next;
}

async function getValidSession() {
  const current = await getStoredSession();
  return refreshSessionIfNeeded(current);
}

async function fetchApi(path, payload, token) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorJson = await response.json().catch(() => ({}));
    return {
      ok: false,
      status: response.status,
      error: errorJson.error || "API request failed",
      code: errorJson.code,
      usage: errorJson.usage
    };
  }

  const data = await response.json();
  return { ok: true, data };
}

async function getUsageFromServer(token) {
  const response = await fetch(`${API_BASE}/api/usage`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new Error("Failed to load usage from server");
  }

  const json = await response.json();
  const usage = {
    used: json.usage.used,
    limit: json.usage.limit,
    remaining: json.usage.remaining,
    tier: json.user.plan,
    isExhausted: json.usage.remaining <= 0
  };
  return { usage, user: json.user };
}

chrome.runtime.onInstalled.addListener(async () => {
  await readUsageState();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (!message || !message.type) {
      sendResponse({ ok: false, error: "Invalid message" });
      return;
    }

    if (message.type === "LOGIN") {
      const session = await loginWithGoogleOAuth();
      sendResponse({ ok: true, session });
      return;
    }

    if (message.type === "LOGOUT") {
      await clearStoredSession();
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "GET_AUTH_SESSION") {
      const session = await getValidSession();
      sendResponse({ ok: true, session });
      return;
    }

    if (message.type === "GET_USAGE") {
      const session = await getValidSession();
      if (session?.access_token) {
        try {
          const server = await getUsageFromServer(session.access_token);
          sendResponse({ ok: true, usage: server.usage, user: server.user, auth: session.user });
          return;
        } catch (_) {
          // Fall through to local usage if server fails.
        }
      }

      const usage = await getUsageResponse();
      sendResponse({ ok: true, usage, user: null, auth: null });
      return;
    }

    if (message.type === "COMPRESS_PROMPT") {
      const prompt = typeof message.prompt === "string" ? message.prompt : "";
      if (!prompt.trim()) {
        sendResponse({ ok: false, error: "Empty prompt" });
        return;
      }

      const passedToken = typeof message.accessToken === "string" ? message.accessToken : null;
      const session = passedToken ? { access_token: passedToken } : await getValidSession();

      if (session?.access_token) {
        const result = await fetchApi("/api/compress", { prompt }, session.access_token);
        if (!result.ok) {
          sendResponse({
            ok: false,
            error: result.error,
            code: result.code,
            usage: result.usage
          });
          return;
        }

        const usage = result.data.usage
          ? {
              ...result.data.usage,
              tier: result.data.plan,
              isExhausted: result.data.usage.remaining <= 0
            }
          : null;

        if (usage) {
          await broadcastUsage(usage);
        }

        sendResponse({ ok: true, result: result.data, usage });
        return;
      }

      const usage = await getUsageResponse();
      if (usage.isExhausted) {
        sendResponse({ ok: false, error: "Daily limit reached", code: "LIMIT_REACHED", usage });
        return;
      }

      const result = await fetchApi("/api/compress", { prompt }, null);
      if (!result.ok) {
        sendResponse({ ok: false, error: result.error || "Compression failed" });
        return;
      }

      sendResponse({ ok: true, result: result.data, usage });
      return;
    }

    if (message.type === "CONSUME_COMPRESSION") {
      const session = await getValidSession();
      if (session?.access_token) {
        try {
          const server = await getUsageFromServer(session.access_token);
          await broadcastUsage(server.usage);
          sendResponse({ ok: true, usage: server.usage });
          return;
        } catch (_) {
          sendResponse({ ok: true, usage: null });
          return;
        }
      }

      const localUsage = await consumeCompression();
      sendResponse({ ok: true, usage: localUsage });
      return;
    }

    sendResponse({ ok: false, error: `Unknown message type: ${message.type}` });
  })().catch((err) => {
    sendResponse({ ok: false, error: err.message || "Unexpected error" });
  });

  return true;
});

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== "local" || !changes[USAGE_KEY]) {
    return;
  }

  const usage = await getUsageResponse();
  await broadcastUsage(usage);
});
