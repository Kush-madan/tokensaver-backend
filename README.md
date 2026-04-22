# TokenSaver — Chrome Extension

> **Get more from AI** — Auto-compress prompts, continue cut-off responses, and never lose context again.

TokenSaver is a Chrome Extension that sits on top of **Claude.ai** and **ChatGPT**. It silently optimizes every conversation — compressing prompts, continuing cut-off responses, managing memory, and splitting large tasks. You get more output, hit fewer limits, and never lose context.

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| **⚡ Prompt Compressor** | Automatically shortens your prompts before sending — removes filler words, redundancy, and fluff while keeping 100% of the meaning |
| **▶ Smart Continue** | Injects a floating "Continue" button after every AI response. If the response was cut off, the button turns orange |
| **🧠 Memory Trimmer** | Estimates token usage in real time. When conversation exceeds 60% of the context window, older messages are automatically summarized |
| **🟢 Context Health** | A color-coded pill shows your context window usage: green (plenty), yellow (getting full), red (near limit) |
| **📋 Task Splitter** | Detects prompts over 400 words and offers to intelligently split them into 2–4 parts, sending each sequentially |

---

## 🚀 Quick Start

### 1. Load the Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top right)
3. Click **"Load unpacked"**
4. Select the root `token-saver/` folder (the one containing `manifest.json`)
5. The TokenSaver icon will appear in your toolbar

### 2. Deploy the Backend to Vercel

```bash
# Navigate to the backend folder
cd backend

# Install dependencies
npm install

# Install Vercel CLI (if not already)
npm install -g vercel

# Login to Vercel
vercel login

# Deploy
vercel --prod
```

### 3. Add Environment Variables in Vercel

Go to your Vercel project → **Settings → Environment Variables** and add:

| Variable | Value |
|----------|-------|
| `ANTHROPIC_API_KEY` | Your Anthropic API key (get from [console.anthropic.com](https://console.anthropic.com)) |
| `ALLOWED_ORIGIN` | `chrome-extension://YOUR_EXTENSION_ID` (find your extension ID on `chrome://extensions/`) |

### 4. Connect Extension to Backend

Open `background.js` and replace:

```javascript
const BACKEND_URL = "YOUR_VERCEL_URL_HERE";
```

with your deployed Vercel URL:

```javascript
const BACKEND_URL = "https://your-project-name.vercel.app";
```

Then reload the extension on `chrome://extensions/`.

---

## 🧪 Testing Each Feature

### Prompt Compressor
1. Go to [claude.ai](https://claude.ai) or [chatgpt.com](https://chatgpt.com)
2. Type a verbose prompt like: *"Hey, so I was wondering if you could possibly help me write a business plan for my new restaurant idea"*
3. Hit Enter — you should see a **"✦ Compressed"** badge appear briefly
4. Check the browser console for `[TokenSaver]` logs showing compression stats

### Smart Continue Button
1. Ask the AI to write something long (e.g., "Write a 2000-word essay about climate change")
2. After the response finishes, a **"Continue ▶"** button appears below
3. If the response was cut off, the button turns **orange**
4. Click it to auto-send a continuation prompt

### Context Health Indicator
1. Start a conversation on Claude.ai or ChatGPT
2. Look at the **bottom-right corner** — a pill-shaped indicator shows context usage
3. As the conversation grows, it changes from 🟢 → 🟡 → 🔴
4. Hover over the **"?"** icon for an explanation

### Memory Trimmer
1. Have a long conversation (20+ messages)
2. Watch the console logs for `[TokenSaver] Memory Trimmer:` messages
3. When context exceeds 60%, older messages get summarized automatically
4. The summary is invisibly prepended to your next message

### Task Splitter
1. Type a prompt longer than 400 words
2. A banner will appear: **"This is a large request. Split into parts?"**
3. Click **"Split It"** to divide and send parts sequentially
4. A progress bar shows which part is being processed

---

## 🏗️ Project Structure

```
token-saver/
├── manifest.json            # Chrome Extension manifest v3
├── background.js            # Service worker — routes API calls
├── content/
│   ├── shared.js            # Shared utilities (cut-off detection, DOM helpers)
│   ├── claude.js            # Claude.ai specific implementation
│   └── chatgpt.js           # ChatGPT specific implementation
├── popup/
│   ├── popup.html           # Extension popup UI
│   ├── popup.css            # Dark theme styles
│   └── popup.js             # Popup controller
├── utils/
│   ├── tokenCounter.js      # Token estimation utilities
│   ├── compressor.js        # Compression client + local fallback
│   ├── memory.js            # Memory management utilities
│   └── splitter.js          # Task splitting utilities
├── backend/
│   ├── api/
│   │   ├── compress.js      # POST /api/compress
│   │   ├── summarize.js     # POST /api/summarize
│   │   └── split.js         # POST /api/split
│   ├── package.json
│   └── vercel.json
├── styles/
│   └── injected.css         # Styles injected into AI chat pages
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

---

## 🔧 API Endpoints

### `POST /api/compress`
Compresses a user prompt while preserving meaning.

```json
// Request
{ "prompt": "Hey so I was wondering if you could possibly help me..." }

// Response
{ "compressed": "Help me write...", "originalTokens": 45, "compressedTokens": 12 }
```

### `POST /api/summarize`
Summarizes older conversation messages into a dense paragraph.

```json
// Request
{ "messages": [{ "role": "user", "content": "..." }, { "role": "assistant", "content": "..." }] }

// Response
{ "summary": "The conversation covered..." }
```

### `POST /api/split`
Splits a large prompt into 2–4 logical parts.

```json
// Request
{ "prompt": "Very long task description..." }

// Response
{ "parts": ["Part 1: ...", "Part 2: ...", "Part 3: ..."] }
```

---

## 📦 Publishing to Chrome Web Store

1. **Prepare assets:**
   - Screenshots (1280×800 recommended)
   - Promotional images (440×280 small, 920×680 large)
   - Privacy policy URL

2. **Create a ZIP:**
   ```bash
   # From the project root (exclude backend and node_modules)
   zip -r tokensaver.zip . -x "backend/*" "node_modules/*" ".git/*" "*.md"
   ```

3. **Submit to Chrome Web Store:**
   - Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
   - Pay the one-time $5 developer fee
   - Upload the ZIP
   - Fill in listing details, screenshots, and privacy policy
   - Submit for review (usually takes 1–3 business days)

---

## 🗄️ Database Schema (Future — Supabase)

```sql
-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  plan TEXT DEFAULT 'free',
  compressions_today INT DEFAULT 0,
  tokens_saved_total INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Usage logs
CREATE TABLE usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  action TEXT, -- 'compress', 'continue', 'summarize', 'split'
  tokens_saved INT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 🛡️ Security Notes

- All API calls go through the background service worker to avoid CORS issues
- The backend only accepts requests from the Chrome extension origin
- API keys are stored as Vercel environment variables, never in client code
- No user data is stored except anonymized usage stats in `chrome.storage.local`

---

## 📝 License

MIT — Build whatever you want with it.

---

Built with ❤️ by the TokenSaver team.
