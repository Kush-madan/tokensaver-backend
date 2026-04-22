/**
 * TokenSaver — ChatGPT Content Script
 *
 * Handles all TokenSaver features on chatgpt.com:
 * - Prompt compression (intercept before send)
 * - Continue button injection
 * - Context health indicator
 * - Big task splitter
 * - Memory trimmer
 *
 * ChatGPT uses a React-based UI with contenteditable divs,
 * so we use MutationObserver extensively and handle React's
 * synthetic event system carefully.
 */

(function () {
  "use strict";

  const {
    tsLog,
    tsWarn,
    tsError,
    sendToBackground,
    waitForElement,
    createElement,
    isResponseCutOff,
    getSettings,
    onSettingsChange,
    detectPlatform,
    debounce,
  } = window.TokenSaverShared;

  const TC = window.TokenSaverTokenCounter;

  const PLATFORM = "chatgpt";
  let settings = {};
  let conversationTokens = 0;
  let isProcessingSplit = false;

  /* ═══════════════════════════════════════════
     Selectors — ChatGPT specific
     Update these if ChatGPT changes their DOM
     ═══════════════════════════════════════════ */

  const SELECTORS = {
    /** The main contenteditable input div */
    inputArea: '#prompt-textarea, div[id="prompt-textarea"], div[contenteditable="true"][data-id="root"]',
    /** The send button */
    sendButton: 'button[data-testid="send-button"], button[aria-label="Send prompt"], form button[class*="bottom"]',
    /** The form wrapping the input */
    inputForm: "form",
    /** All message containers */
    messageBlocks: '[data-message-author-role], article[data-testid*="conversation-turn"]',
    /** Assistant messages specifically */
    assistantMessages: '[data-message-author-role="assistant"], article[data-testid*="conversation-turn"]:has(.markdown)',
    /** User messages */
    userMessages: '[data-message-author-role="user"]',
    /** Main conversation container */
    conversationContainer: 'main, div[role="presentation"]',
    /** Streaming indicator */
    streamingIndicator: 'button[aria-label="Stop generating"], div[class*="result-streaming"]',
  };

  /* ═══════════════════════════════════════════
     Initialization
     ═══════════════════════════════════════════ */

  /**
   * Main initialization function. Waits for ChatGPT's React-based
   * DOM to be ready, then sets up all features.
   */
  async function init() {
    tsLog("Initializing on ChatGPT");

    settings = await getSettings();
    tsLog("Current settings:", settings);

    onSettingsChange((newSettings) => {
      settings = newSettings;
      tsLog("Settings updated live:", settings);
    });

    // Wait for the main input area — ChatGPT is SPA, may take a moment
    try {
      await waitForElement(SELECTORS.inputArea, 20000);
      tsLog("ChatGPT DOM ready — input area found");
    } catch (e) {
      tsWarn("Could not find input area, retrying with broader selector...");
      try {
        await waitForElement('[contenteditable="true"], textarea', 20000);
        tsLog("Found fallback input element");
      } catch (e2) {
        tsError("Could not find any input element. Aborting init.");
        return;
      }
    }

    setupPromptInterception();
    setupContinueButtonObserver();
    setupHealthIndicator();
    setupConversationObserver();
    setupNavigationObserver();

    tsLog("All features initialized on ChatGPT ✓");
  }

  /* ═══════════════════════════════════════════
     Navigation Observer
     ChatGPT is a SPA — watch for route changes
     ═══════════════════════════════════════════ */

  /**
   * Watches for ChatGPT's SPA navigation (new chat, switching chats)
   * and re-initializes UI elements.
   */
  function setupNavigationObserver() {
    let lastUrl = window.location.href;

    const observer = new MutationObserver(
      debounce(() => {
        if (window.location.href !== lastUrl) {
          lastUrl = window.location.href;
          tsLog("Navigation detected, re-attaching listeners");
          setTimeout(() => {
            attachInputListeners();
            updateTokenCount();
          }, 1500);
        }
      }, 500)
    );

    observer.observe(document.body, { childList: true, subtree: true });
  }

  /* ═══════════════════════════════════════════
     Feature 1: Prompt Compressor
     ═══════════════════════════════════════════ */

  /** @type {boolean} Flag to prevent double-processing */
  let isIntercepting = false;

  /**
   * Sets up interception of the form submission to compress prompts.
   * ChatGPT uses a contenteditable div, not a textarea.
   */
  function setupPromptInterception() {
    tsLog("Setting up prompt interception for ChatGPT");

    // Watch for DOM changes since ChatGPT is React and recreates elements
    const observer = new MutationObserver(
      debounce(() => {
        attachInputListeners();
      }, 500)
    );

    observer.observe(document.body, { childList: true, subtree: true });
    attachInputListeners();
  }

  /**
   * Attaches event listeners to the input area and send button.
   * Handles ChatGPT's React contenteditable div.
   */
  function attachInputListeners() {
    const inputEl = document.querySelector(SELECTORS.inputArea);
    if (inputEl && !inputEl.dataset.tsListening) {
      inputEl.dataset.tsListening = "true";
      inputEl.addEventListener("keydown", handleKeyDown, true);
      tsLog("Attached keydown listener to ChatGPT input");
    }

    const sendBtn = document.querySelector(SELECTORS.sendButton);
    if (sendBtn && !sendBtn.dataset.tsListening) {
      sendBtn.dataset.tsListening = "true";
      sendBtn.addEventListener("click", handleSendClick, true);
      tsLog("Attached click listener to ChatGPT send button");
    }

    // Also intercept the form submit
    const form = document.querySelector(SELECTORS.inputForm);
    if (form && !form.dataset.tsListening) {
      form.dataset.tsListening = "true";
      form.addEventListener("submit", handleFormSubmit, true);
      tsLog("Attached submit listener to ChatGPT form");
    }
  }

  /**
   * Handles keydown on the ChatGPT input.
   * @param {KeyboardEvent} e
   */
  async function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey && !isIntercepting && !isProcessingSplit) {
      const inputEl = document.querySelector(SELECTORS.inputArea);
      const text = getInputText(inputEl);

      if (text.trim().length === 0) return;

      // Check task splitter
      if (settings.taskSplitter && window.TokenSaverSplitter?.shouldSuggestSplit(text)) {
        e.preventDefault();
        e.stopPropagation();
        showSplitBanner(text, inputEl);
        return;
      }

      if (settings.compressor && text.trim().length > 30) {
        e.preventDefault();
        e.stopPropagation();
        await processAndSend(text, inputEl);
      }
    }
  }

  /**
   * Handles click on the send button.
   * @param {MouseEvent} e
   */
  async function handleSendClick(e) {
    if (isIntercepting || isProcessingSplit) return;

    const inputEl = document.querySelector(SELECTORS.inputArea);
    const text = getInputText(inputEl);

    if (text.trim().length === 0) return;

    if (settings.taskSplitter && window.TokenSaverSplitter?.shouldSuggestSplit(text)) {
      e.preventDefault();
      e.stopPropagation();
      showSplitBanner(text, inputEl);
      return;
    }

    if (settings.compressor && text.trim().length > 30) {
      e.preventDefault();
      e.stopPropagation();
      await processAndSend(text, inputEl);
    }
  }

  /**
   * Handles form submission.
   * @param {SubmitEvent} e
   */
  async function handleFormSubmit(e) {
    if (isIntercepting || isProcessingSplit) return;

    const inputEl = document.querySelector(SELECTORS.inputArea);
    const text = getInputText(inputEl);

    if (text.trim().length === 0) return;

    if (settings.compressor && text.trim().length > 30) {
      e.preventDefault();
      e.stopPropagation();
      await processAndSend(text, inputEl);
    }
  }

  /**
   * Gets text from ChatGPT's contenteditable input.
   * @param {Element} el - The input element
   * @returns {string} The text content
   */
  function getInputText(el) {
    if (!el) return "";
    // ChatGPT uses a contenteditable div or a special textarea
    if (el.tagName === "TEXTAREA") return el.value;
    return el.innerText || el.textContent || "";
  }

  /**
   * Sets text in ChatGPT's contenteditable input.
   * Carefully handles React's state management.
   * @param {Element} el - The input element
   * @param {string} text - The text to set
   */
  function setInputText(el, text) {
    if (!el) return;

    if (el.tagName === "TEXTAREA") {
      // Native textarea approach
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value"
      ).set;
      nativeSetter.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }

    // ContentEditable div approach (ChatGPT's ProseMirror-like editor)
    el.focus();
    el.innerHTML = "";

    // Create a paragraph element for the text
    const p = document.createElement("p");
    p.textContent = text;
    el.appendChild(p);

    // Fire events that React listens for
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));

    // Also try the InputEvent for React 17+ compatibility
    try {
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: text,
        })
      );
    } catch (e) {
      // InputEvent constructor may not support all options in all browsers
    }
  }

  /**
   * Triggers the send button click programmatically.
   */
  function triggerSend() {
    // Wait a tick for React to update the button state
    setTimeout(() => {
      const sendBtn = document.querySelector(SELECTORS.sendButton);
      if (sendBtn && !sendBtn.disabled) {
        sendBtn.click();
        tsLog("Send triggered on ChatGPT");
      } else {
        // Fallback: dispatch Enter key
        const inputEl = document.querySelector(SELECTORS.inputArea);
        if (inputEl) {
          inputEl.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Enter",
              code: "Enter",
              keyCode: 13,
              which: 13,
              bubbles: true,
            })
          );
        }
      }
    }, 150);
  }

  /**
   * Compresses the prompt and sends it.
   * @param {string} originalText - The original prompt text
   * @param {Element} inputEl - The input element
   */
  async function processAndSend(originalText, inputEl) {
    isIntercepting = true;

    // Memory trimmer
    let textToProcess = originalText;
    if (settings.memoryTrimmer) {
      textToProcess = await applyMemoryTrimmer(textToProcess);
    }

    let spinnerTimer = null;
    let spinnerEl = null;

    spinnerTimer = setTimeout(() => {
      spinnerEl = showSpinner(inputEl);
    }, 500);

    try {
      const result = await window.TokenSaverCompressor.compressPrompt(textToProcess);

      clearTimeout(spinnerTimer);
      if (spinnerEl) removeElement(spinnerEl);

      if (result.wasCompressed && result.compressed !== textToProcess) {
        setInputText(inputEl, result.compressed);
        showCompressedBadge(inputEl);

        const tokensSaved = result.originalTokens - result.compressedTokens;
        sendToBackground("UPDATE_STATS", {
          stat: "compression",
          value: tokensSaved,
        });

        tsLog(
          `Compressed: ${result.originalTokens} → ${result.compressedTokens} tokens (saved ${tokensSaved})`
        );
      } else {
        setInputText(inputEl, textToProcess);
      }

      await sleep(200);
      triggerSend();
    } catch (error) {
      clearTimeout(spinnerTimer);
      if (spinnerEl) removeElement(spinnerEl);
      tsError("Compression failed, sending original:", error);
      setInputText(inputEl, textToProcess);
      await sleep(200);
      triggerSend();
    }

    isIntercepting = false;
  }

  /**
   * Shows the "✦ Compressed" badge near the input.
   * @param {Element} inputEl - The input element
   */
  function showCompressedBadge(inputEl) {
    const existing = document.querySelector(".ts-compressed-badge");
    if (existing) existing.remove();

    const container = inputEl.closest(SELECTORS.inputForm) || inputEl.parentElement;
    if (!container) return;

    container.style.position = container.style.position || "relative";

    const badge = createElement(
      "div",
      { className: "ts-compressed-badge" },
      '<span class="ts-badge-icon">✦</span> Compressed'
    );

    container.appendChild(badge);

    setTimeout(() => {
      badge.classList.add("ts-fade-out");
      setTimeout(() => badge.remove(), 300);
    }, 2500);
  }

  /**
   * Shows a loading spinner during compression.
   * @param {Element} inputEl - The input element
   * @returns {Element} The spinner element
   */
  function showSpinner(inputEl) {
    const container = inputEl.closest(SELECTORS.inputForm) || inputEl.parentElement;
    if (!container) return null;

    container.style.position = container.style.position || "relative";

    const spinner = createElement(
      "div",
      { className: "ts-spinner" },
      '<span class="ts-spinner-dot"></span><span class="ts-spinner-dot"></span><span class="ts-spinner-dot"></span> Compressing...'
    );

    container.appendChild(spinner);
    return spinner;
  }

  /* ═══════════════════════════════════════════
     Feature 2: Smart Continue Button
     ═══════════════════════════════════════════ */

  /**
   * Sets up a MutationObserver to detect new assistant messages
   * and inject the Continue button.
   */
  function setupContinueButtonObserver() {
    if (!settings.continueButton) return;

    tsLog("Setting up continue button observer for ChatGPT");

    const observer = new MutationObserver(
      debounce(() => {
        if (!settings.continueButton) return;
        injectContinueButtons();
      }, 1500)
    );

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    setTimeout(injectContinueButtons, 3000);
  }

  /**
   * Injects continue buttons after the last assistant message.
   */
  function injectContinueButtons() {
    // Remove existing buttons
    document.querySelectorAll(".ts-continue-btn").forEach((btn) => btn.remove());

    const assistantMsgs = document.querySelectorAll(SELECTORS.assistantMessages);
    if (assistantMsgs.length === 0) return;

    // Check if still streaming
    const isStreaming = document.querySelector(SELECTORS.streamingIndicator);
    if (isStreaming) return;

    const lastMsg = assistantMsgs[assistantMsgs.length - 1];
    const responseText = lastMsg.innerText || lastMsg.textContent || "";
    const cutOff = isResponseCutOff(responseText);

    const btn = createElement(
      "button",
      {
        className: `ts-continue-btn ${cutOff ? "ts-cutoff" : ""}`,
        onClick: () => handleContinueClick(btn),
      },
      `<span class="ts-continue-tooltip">Response cut off? Click to continue automatically</span>
       Continue <span class="ts-btn-icon">▶</span>`
    );

    // Insert after the last assistant message
    if (lastMsg.parentElement) {
      lastMsg.parentElement.insertBefore(btn, lastMsg.nextSibling);
    }

    updateTokenCount();
  }

  /**
   * Handles the Continue button click.
   * @param {Element} btn - The button element
   */
  async function handleContinueClick(btn) {
    btn.remove();

    const continuePrompt =
      "Please continue from exactly where you left off, do not repeat anything";

    const inputEl = document.querySelector(SELECTORS.inputArea);
    if (inputEl) {
      setInputText(inputEl, continuePrompt);
      await sleep(300);
      triggerSend();

      sendToBackground("UPDATE_STATS", {
        stat: "continuation",
        value: 0,
      });

      tsLog("Continue prompt sent on ChatGPT");
    }
  }

  /* ═══════════════════════════════════════════
     Feature 3: Memory Trimmer
     ═══════════════════════════════════════════ */

  /**
   * Applies the memory trimmer logic.
   * @param {string} prompt - The user's prompt
   * @returns {Promise<string>} The prompt with prepended context if needed
   */
  async function applyMemoryTrimmer(prompt) {
    const Memory = window.TokenSaverMemory;
    if (!Memory) return prompt;

    try {
      const messages = extractAllMessages();
      const totalTokens = TC.estimateConversationTokens(messages);

      tsLog(`Memory Trimmer: ${messages.length} messages, ~${totalTokens} tokens`);

      if (Memory.shouldSummarize(totalTokens, PLATFORM)) {
        tsLog("Memory Trimmer: Context threshold exceeded, triggering summarization");

        const { summary, success } = await Memory.triggerSummarization(messages);
        if (success && summary) {
          const tabId = await window.TokenSaverShared.getCurrentTabId();
          await Memory.storeSummary(tabId, summary);
          tsLog("Memory Trimmer: Summary stored");
        }
      }

      const tabId = await window.TokenSaverShared.getCurrentTabId();
      const existingSummary = await Memory.getSummary(tabId);
      if (existingSummary) {
        return Memory.prependSummaryContext(prompt, existingSummary);
      }
    } catch (error) {
      tsError("Memory Trimmer error:", error);
    }

    return prompt;
  }

  /**
   * Extracts all conversation messages from ChatGPT's DOM.
   * @returns {Array<{role: string, content: string}>}
   */
  function extractAllMessages() {
    const messages = [];

    // ChatGPT uses data-message-author-role attribute
    const msgEls = document.querySelectorAll("[data-message-author-role]");

    for (const el of msgEls) {
      const role = el.getAttribute("data-message-author-role");
      if (role !== "user" && role !== "assistant") continue;

      const content = el.innerText || el.textContent || "";
      if (content.trim()) {
        messages.push({
          role: role === "user" ? "user" : "assistant",
          content: content.trim(),
        });
      }
    }

    // Fallback: try article-based structure
    if (messages.length === 0) {
      const articles = document.querySelectorAll("article");
      let roleToggle = "user"; // Assume first is user
      for (const article of articles) {
        const content = article.innerText || article.textContent || "";
        if (content.trim()) {
          messages.push({ role: roleToggle, content: content.trim() });
          roleToggle = roleToggle === "user" ? "assistant" : "user";
        }
      }
    }

    return messages;
  }

  /* ═══════════════════════════════════════════
     Feature 4: Context Health Indicator
     ═══════════════════════════════════════════ */

  /** @type {Element|null} */
  let healthIndicator = null;

  /**
   * Creates and injects the context health indicator.
   */
  function setupHealthIndicator() {
    tsLog("Setting up health indicator for ChatGPT");

    healthIndicator = createElement(
      "div",
      { className: "ts-health-indicator", id: "ts-health-indicator" },
      `<span class="ts-health-dot ts-healthy"></span>
       <span class="ts-health-label">0% · Plenty of space</span>
       <span class="ts-health-help">?
         <span class="ts-health-help-tooltip">
           The <strong>context window</strong> is the maximum amount of text an AI can process in a single conversation. As you chat, it fills up. When it's full, the AI starts forgetting earlier messages. TokenSaver helps you stay within limits.
         </span>
       </span>`
    );

    document.body.appendChild(healthIndicator);
    updateTokenCount();
  }

  /**
   * Updates the token count and health indicator.
   */
  function updateTokenCount() {
    if (!healthIndicator) return;

    const messages = extractAllMessages();
    conversationTokens = TC.estimateConversationTokens(messages);
    const percent = TC.getContextUsagePercent(conversationTokens, PLATFORM);
    const health = TC.getHealthStatus(percent);

    const dot = healthIndicator.querySelector(".ts-health-dot");
    const label = healthIndicator.querySelector(".ts-health-label");

    if (dot) dot.className = `ts-health-dot ts-${health.status}`;
    if (label) label.textContent = `${percent}% · ${health.label}`;
  }

  /* ═══════════════════════════════════════════
     Feature 5: Big Task Splitter
     ═══════════════════════════════════════════ */

  /**
   * Shows the split suggestion banner.
   * @param {string} text - The large prompt text
   * @param {Element} inputEl - The input element
   */
  function showSplitBanner(text, inputEl) {
    const existing = document.querySelector(".ts-split-banner");
    if (existing) existing.remove();

    const container = inputEl.closest(SELECTORS.inputForm) || inputEl.parentElement;
    if (!container) return;

    const wordCount = TC.countWords(text);

    const banner = createElement(
      "div",
      { className: "ts-split-banner" },
      `<span class="ts-split-banner-icon">📋</span>
       <span class="ts-split-banner-text">
         This is a large request (${wordCount} words). Split into parts for better results?
       </span>
       <div class="ts-split-banner-actions">
         <button class="ts-split-btn ts-split-btn-primary" id="ts-split-yes">Split It</button>
         <button class="ts-split-btn ts-split-btn-secondary" id="ts-split-no">No Thanks</button>
       </div>`
    );

    container.parentElement.insertBefore(banner, container);

    banner.querySelector("#ts-split-yes").addEventListener("click", () => {
      banner.remove();
      executeSplit(text, inputEl);
    });

    banner.querySelector("#ts-split-no").addEventListener("click", () => {
      banner.classList.add("ts-fade-out");
      setTimeout(() => banner.remove(), 300);
      isIntercepting = true;
      if (settings.compressor) {
        processAndSend(text, inputEl).then(() => {
          isIntercepting = false;
        });
      } else {
        setInputText(inputEl, text);
        sleep(150).then(() => {
          triggerSend();
          isIntercepting = false;
        });
      }
    });
  }

  /**
   * Executes the split workflow.
   * @param {string} text - The full prompt
   * @param {Element} inputEl - The input element
   */
  async function executeSplit(text, inputEl) {
    isProcessingSplit = true;

    const Splitter = window.TokenSaverSplitter;
    if (!Splitter) {
      tsError("Splitter utility not available");
      isProcessingSplit = false;
      return;
    }

    const container = inputEl.closest(SELECTORS.inputForm) || inputEl.parentElement;

    const progress = createElement(
      "div",
      { className: "ts-split-progress" },
      `<span>📋 Splitting task...</span>
       <div class="ts-progress-bar"><div class="ts-progress-fill" style="width: 0%"></div></div>
       <span class="ts-progress-label">0/0</span>`
    );
    if (container.parentElement) {
      container.parentElement.insertBefore(progress, container);
    }

    try {
      const { parts, success } = await Splitter.splitPrompt(text);

      if (!success || parts.length <= 1) {
        tsWarn("Split failed, sending original");
        progress.remove();
        setInputText(inputEl, text);
        await sleep(200);
        triggerSend();
        isProcessingSplit = false;
        return;
      }

      await Splitter.saveSplitState({
        parts,
        currentPart: 0,
        active: true,
      });

      const progressLabel = progress.querySelector(".ts-progress-label");
      const progressFill = progress.querySelector(".ts-progress-fill");

      for (let i = 0; i < parts.length; i++) {
        const partLabel = `[Part ${i + 1}/${parts.length}] `;

        if (progressLabel) progressLabel.textContent = `${i + 1}/${parts.length}`;
        if (progressFill) progressFill.style.width = `${((i + 1) / parts.length) * 100}%`;

        tsLog(`Sending Part ${i + 1}/${parts.length}`);

        setInputText(inputEl, partLabel + parts[i]);
        await sleep(400);
        triggerSend();

        if (i < parts.length - 1) {
          await waitForResponseComplete();
          await sleep(1500);
        }
      }

      progress.remove();
      const complete = createElement(
        "div",
        { className: "ts-split-complete" },
        "✓ All parts completed. Full task done."
      );
      if (container.parentElement) {
        container.parentElement.insertBefore(complete, container);
      }
      setTimeout(() => {
        complete.classList.add("ts-fade-out");
        setTimeout(() => complete.remove(), 300);
      }, 5000);

      await Splitter.clearSplitState();
    } catch (error) {
      tsError("Split execution failed:", error);
      progress.remove();
    }

    isProcessingSplit = false;
  }

  /**
   * Waits for ChatGPT to finish streaming its response.
   * @param {number} [timeout=120000] - Max wait time
   * @returns {Promise<void>}
   */
  function waitForResponseComplete(timeout = 120000) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let lastContentLength = 0;
      let stableCount = 0;

      const check = setInterval(() => {
        if (Date.now() - startTime > timeout) {
          clearInterval(check);
          resolve();
          return;
        }

        const isStreaming = document.querySelector(SELECTORS.streamingIndicator);

        if (!isStreaming) {
          const msgs = document.querySelectorAll(SELECTORS.assistantMessages);
          const lastMsg = msgs[msgs.length - 1];
          const currentLength = lastMsg ? lastMsg.textContent.length : 0;

          if (currentLength === lastContentLength && currentLength > 0) {
            stableCount++;
            if (stableCount >= 3) {
              clearInterval(check);
              resolve();
              return;
            }
          } else {
            stableCount = 0;
          }
          lastContentLength = currentLength;
        }
      }, 2000);
    });
  }

  /* ═══════════════════════════════════════════
     Conversation Observer
     ═══════════════════════════════════════════ */

  /**
   * Watches for conversation changes and updates UI.
   */
  function setupConversationObserver() {
    const debouncedUpdate = debounce(() => {
      updateTokenCount();
      if (settings.continueButton) {
        injectContinueButtons();
      }
    }, 2000);

    const observer = new MutationObserver(() => {
      debouncedUpdate();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    tsLog("Conversation observer active for ChatGPT");
  }

  /* ═══════════════════════════════════════════
     Helpers
     ═══════════════════════════════════════════ */

  /**
   * Promise-based sleep.
   * @param {number} ms - Milliseconds to wait
   * @returns {Promise<void>}
   */
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Safely removes an element.
   * @param {Element} el
   */
  function removeElement(el) {
    if (el && el.parentElement) el.remove();
  }

  /* ═══════════════════════════════════════════
     Bootstrap
     ═══════════════════════════════════════════ */

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(init, 1500));
  } else {
    setTimeout(init, 1500);
  }
})();
