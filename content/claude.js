/**
 * TokenSaver — Claude.ai Content Script
 *
 * Handles all TokenSaver features on the Claude.ai platform:
 * - Prompt compression (intercept before send)
 * - Continue button injection
 * - Context health indicator
 * - Big task splitter
 * - Memory trimmer
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

  const PLATFORM = "claude";
  let settings = {};
  let conversationTokens = 0;
  let isProcessingSplit = false;

  /* ═══════════════════════════════════════════
     Selectors — Claude.ai specific
     Update these if Claude changes their DOM
     ═══════════════════════════════════════════ */

  const SELECTORS = {
    /** The main message input area */
    inputArea: '[contenteditable="true"][data-placeholder], div.ProseMirror[contenteditable="true"], fieldset textarea',
    /** The send/submit button */
    sendButton: 'button[aria-label="Send Message"], button[data-testid="send-button"], fieldset button[type="button"]:last-of-type',
    /** Container holding the input + send button */
    inputContainer: 'form, fieldset, div[class*="composer"], div[class*="input"]',
    /** Individual message blocks (both user and assistant) */
    messageBlocks: '[data-testid="user-message"], [data-testid="assistant-message"], div[class*="Message"], div[class*="message-content"]',
    /** Assistant response containers specifically */
    assistantMessages: '[data-testid="assistant-message"], div[class*="AssistantMessage"], div[class*="response"]',
    /** The main conversation container */
    conversationContainer: 'div[class*="conversation"], div[class*="thread"], main',
    /** User message containers */
    userMessages: '[data-testid="user-message"], div[class*="UserMessage"], div[class*="human"]',
  };

  /* ═══════════════════════════════════════════
     Initialization
     ═══════════════════════════════════════════ */

  /**
   * Main initialization function. Waits for the DOM to be ready,
   * then sets up all features.
   */
  async function init() {
    tsLog("Initializing on Claude.ai");

    settings = await getSettings();
    tsLog("Current settings:", settings);

    onSettingsChange((newSettings) => {
      settings = newSettings;
      tsLog("Settings updated live:", settings);
    });

    // Wait for the main input area to appear
    try {
      await waitForElement(SELECTORS.inputArea, 15000);
      tsLog("Claude.ai DOM ready — input area found");
    } catch (e) {
      tsWarn("Could not find input area, retrying with broader selector...");
      try {
        await waitForElement("textarea, [contenteditable]", 15000);
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

    tsLog("All features initialized on Claude.ai ✓");
  }

  /* ═══════════════════════════════════════════
     Feature 1: Prompt Compressor
     ═══════════════════════════════════════════ */

  /**
   * Sets up interception of the form submission to compress the prompt
   * before it reaches Claude.
   */
  function setupPromptInterception() {
    tsLog("Setting up prompt interception");

    // Watch for new input elements (Claude re-creates them sometimes)
    const observer = new MutationObserver(
      debounce(() => {
        attachInputListeners();
      }, 500)
    );

    observer.observe(document.body, { childList: true, subtree: true });
    attachInputListeners();
  }

  /** @type {boolean} Flag to prevent double-processing */
  let isIntercepting = false;

  /**
   * Attaches event listeners to the input area and send button.
   */
  function attachInputListeners() {
    // Listen for Enter key in the input area
    const inputEl = document.querySelector(SELECTORS.inputArea);
    if (inputEl && !inputEl.dataset.tsListening) {
      inputEl.dataset.tsListening = "true";
      inputEl.addEventListener("keydown", handleKeyDown, true);
      tsLog("Attached keydown listener to input area");
    }

    // Also watch for click on send button
    const sendBtn = document.querySelector(SELECTORS.sendButton);
    if (sendBtn && !sendBtn.dataset.tsListening) {
      sendBtn.dataset.tsListening = "true";
      sendBtn.addEventListener("click", handleSendClick, true);
      tsLog("Attached click listener to send button");
    }
  }

  /**
   * Handles keydown events on the input, intercepting Enter (without Shift).
   * @param {KeyboardEvent} e
   */
  async function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey && !isIntercepting && !isProcessingSplit) {
      const inputEl = document.querySelector(SELECTORS.inputArea);
      const text = getInputText(inputEl);

      if (text.trim().length === 0) return;

      // Check if task splitter should fire
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
   * Handles click on the send button, intercepting the send action.
   * @param {MouseEvent} e
   */
  async function handleSendClick(e) {
    if (isIntercepting || isProcessingSplit) return;

    const inputEl = document.querySelector(SELECTORS.inputArea);
    const text = getInputText(inputEl);

    if (text.trim().length === 0) return;

    // Check if task splitter should fire
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
   * Compresses the prompt and sends it.
   * @param {string} originalText - The original prompt text
   * @param {Element} inputEl - The input element
   */
  async function processAndSend(originalText, inputEl) {
    isIntercepting = true;

    // Check memory trimmer — prepend summary if needed
    let textToProcess = originalText;
    if (settings.memoryTrimmer) {
      textToProcess = await applyMemoryTrimmer(textToProcess);
    }

    // Show spinner if compression takes > 500ms
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

        // Track stats
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

      // Brief delay then trigger send
      await sleep(100);
      triggerSend();
    } catch (error) {
      clearTimeout(spinnerTimer);
      if (spinnerEl) removeElement(spinnerEl);
      tsError("Compression failed, sending original:", error);
      setInputText(inputEl, textToProcess);
      await sleep(100);
      triggerSend();
    }

    isIntercepting = false;
  }

  /**
   * Gets the text content from the input element.
   * @param {Element} el - The input element
   * @returns {string} The text content
   */
  function getInputText(el) {
    if (!el) return "";
    if (el.tagName === "TEXTAREA") return el.value;
    return el.innerText || el.textContent || "";
  }

  /**
   * Sets the text content of the input element.
   * Uses appropriate method based on element type.
   * @param {Element} el - The input element
   * @param {string} text - The text to set
   */
  function setInputText(el, text) {
    if (!el) return;

    if (el.tagName === "TEXTAREA") {
      // Handle native textarea
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value"
      ).set;
      nativeSetter.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      // Handle contenteditable / ProseMirror
      el.focus();

      // Clear existing content
      el.innerHTML = "";

      // Insert text through a paragraph for ProseMirror compatibility
      const p = document.createElement("p");
      p.textContent = text;
      el.appendChild(p);

      // Dispatch input event
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  /**
   * Programmatically triggers the send button click.
   */
  function triggerSend() {
    const sendBtn = document.querySelector(SELECTORS.sendButton);
    if (sendBtn) {
      sendBtn.click();
      tsLog("Send triggered programmatically");
    } else {
      // Fallback: try pressing Enter
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
  }

  /**
   * Shows the "✦ Compressed" animated badge near the input.
   * @param {Element} inputEl - The input element for positioning
   */
  function showCompressedBadge(inputEl) {
    // Remove any existing badge
    const existing = document.querySelector(".ts-compressed-badge");
    if (existing) existing.remove();

    const container = inputEl.closest(SELECTORS.inputContainer) || inputEl.parentElement;
    if (!container) return;

    container.style.position = container.style.position || "relative";

    const badge = createElement(
      "div",
      { className: "ts-compressed-badge" },
      '<span class="ts-badge-icon">✦</span> Compressed'
    );

    container.appendChild(badge);

    // Auto-remove after 2.5 seconds
    setTimeout(() => {
      badge.classList.add("ts-fade-out");
      setTimeout(() => badge.remove(), 300);
    }, 2500);
  }

  /**
   * Shows a loading spinner near the input while compression is in progress.
   * @param {Element} inputEl - The input element for positioning
   * @returns {Element} The spinner element
   */
  function showSpinner(inputEl) {
    const container = inputEl.closest(SELECTORS.inputContainer) || inputEl.parentElement;
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
   * Sets up a MutationObserver to watch for new assistant messages
   * and inject the Continue button after each one.
   */
  function setupContinueButtonObserver() {
    if (!settings.continueButton) return;

    tsLog("Setting up continue button observer");

    const observer = new MutationObserver(
      debounce(() => {
        if (!settings.continueButton) return;
        injectContinueButtons();
      }, 1000)
    );

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // Initial injection
    setTimeout(injectContinueButtons, 2000);
  }

  /**
   * Finds all assistant messages and injects a Continue button
   * after the last one (if not already present).
   */
  function injectContinueButtons() {
    // Remove all existing continue buttons first
    document.querySelectorAll(".ts-continue-btn").forEach((btn) => btn.remove());

    // Find all assistant messages
    const assistantMsgs = document.querySelectorAll(SELECTORS.assistantMessages);
    if (assistantMsgs.length === 0) return;

    // Only add button after the last assistant message
    const lastMsg = assistantMsgs[assistantMsgs.length - 1];
    const responseText = lastMsg.innerText || lastMsg.textContent || "";

    // Check if AI is still streaming (look for streaming indicators)
    const isStreaming =
      document.querySelector('[class*="streaming"]') ||
      document.querySelector('[class*="cursor"]') ||
      document.querySelector('[data-is-streaming="true"]');

    if (isStreaming) return; // Don't inject while streaming

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
    lastMsg.parentElement.insertBefore(btn, lastMsg.nextSibling);

    // Update token count
    updateTokenCount();
  }

  /**
   * Handles clicking the Continue button.
   * Sends a "continue" prompt to the AI.
   * @param {Element} btn - The continue button element
   */
  async function handleContinueClick(btn) {
    btn.remove();

    const continuePrompt =
      "Please continue from exactly where you left off, do not repeat anything";

    const inputEl = document.querySelector(SELECTORS.inputArea);
    if (inputEl) {
      setInputText(inputEl, continuePrompt);
      await sleep(200);
      triggerSend();

      // Update stats
      sendToBackground("UPDATE_STATS", {
        stat: "continuation",
        value: 0,
      });

      tsLog("Continue prompt sent");
    }
  }

  /* ═══════════════════════════════════════════
     Feature 3: Memory Trimmer
     ═══════════════════════════════════════════ */

  /**
   * Applies the memory trimmer to a prompt.
   * Checks if summarization is needed and prepends context if available.
   * @param {string} prompt - The user's prompt
   * @returns {Promise<string>} The prompt, potentially with prepended context
   */
  async function applyMemoryTrimmer(prompt) {
    const Memory = window.TokenSaverMemory;
    if (!Memory) return prompt;

    try {
      // Get all messages from the conversation
      const messages = extractAllMessages();
      const totalTokens = TC.estimateConversationTokens(messages);

      tsLog(`Memory Trimmer: ${messages.length} messages, ~${totalTokens} tokens`);

      // Check if we need to summarize
      if (Memory.shouldSummarize(totalTokens, PLATFORM)) {
        tsLog("Memory Trimmer: Context threshold exceeded, triggering summarization");

        const { summary, success } = await Memory.triggerSummarization(messages);
        if (success && summary) {
          const tabId = await window.TokenSaverShared.getCurrentTabId();
          await Memory.storeSummary(tabId, summary);
          tsLog("Memory Trimmer: Summary stored successfully");
        }
      }

      // Check for existing summary and prepend
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
   * Extracts all conversation messages from the DOM.
   * @returns {Array<{role: string, content: string}>} Array of messages
   */
  function extractAllMessages() {
    const messages = [];

    // Get user messages
    const userMsgs = document.querySelectorAll(SELECTORS.userMessages);
    const assistantMsgs = document.querySelectorAll(SELECTORS.assistantMessages);

    // Merge and sort by DOM order
    const allMsgEls = [
      ...Array.from(userMsgs).map((el) => ({ el, role: "user" })),
      ...Array.from(assistantMsgs).map((el) => ({ el, role: "assistant" })),
    ];

    // Sort by document position
    allMsgEls.sort((a, b) => {
      const position = a.el.compareDocumentPosition(b.el);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });

    for (const { el, role } of allMsgEls) {
      const content = el.innerText || el.textContent || "";
      if (content.trim()) {
        messages.push({ role, content: content.trim() });
      }
    }

    return messages;
  }

  /* ═══════════════════════════════════════════
     Feature 4: Context Health Indicator
     ═══════════════════════════════════════════ */

  /** @type {Element|null} The health indicator element */
  let healthIndicator = null;

  /**
   * Creates and injects the context health indicator pill.
   */
  function setupHealthIndicator() {
    tsLog("Setting up health indicator");

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
   * Updates the token count and health indicator display.
   */
  function updateTokenCount() {
    if (!healthIndicator) return;

    const messages = extractAllMessages();
    conversationTokens = TC.estimateConversationTokens(messages);
    const percent = TC.getContextUsagePercent(conversationTokens, PLATFORM);
    const health = TC.getHealthStatus(percent);

    const dot = healthIndicator.querySelector(".ts-health-dot");
    const label = healthIndicator.querySelector(".ts-health-label");

    if (dot) {
      dot.className = `ts-health-dot ts-${health.status}`;
    }
    if (label) {
      label.textContent = `${percent}% · ${health.label}`;
    }
  }

  /* ═══════════════════════════════════════════
     Feature 5: Big Task Splitter
     ═══════════════════════════════════════════ */

  /**
   * Shows the task splitter banner above the input.
   * @param {string} text - The large prompt text
   * @param {Element} inputEl - The input element
   */
  function showSplitBanner(text, inputEl) {
    // Remove any existing banner
    const existing = document.querySelector(".ts-split-banner");
    if (existing) existing.remove();

    const container = inputEl.closest(SELECTORS.inputContainer) || inputEl.parentElement;
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

    // Attach event listeners
    banner.querySelector("#ts-split-yes").addEventListener("click", () => {
      banner.remove();
      executeSplit(text, inputEl);
    });

    banner.querySelector("#ts-split-no").addEventListener("click", () => {
      banner.classList.add("ts-fade-out");
      setTimeout(() => banner.remove(), 300);
      // Send the message as-is
      isIntercepting = true;
      if (settings.compressor) {
        processAndSend(text, inputEl).then(() => {
          isIntercepting = false;
        });
      } else {
        setInputText(inputEl, text);
        sleep(100).then(() => {
          triggerSend();
          isIntercepting = false;
        });
      }
    });
  }

  /**
   * Executes the split workflow: splits the prompt, then sends parts sequentially.
   * @param {string} text - The full prompt text
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

    const container = inputEl.closest(SELECTORS.inputContainer) || inputEl.parentElement;

    // Show progress banner
    const progress = createElement(
      "div",
      { className: "ts-split-progress" },
      `<span>📋 Splitting task...</span>
       <div class="ts-progress-bar"><div class="ts-progress-fill" style="width: 0%"></div></div>
       <span class="ts-progress-label">0/${0}</span>`
    );
    if (container.parentElement) {
      container.parentElement.insertBefore(progress, container);
    }

    try {
      const { parts, success } = await Splitter.splitPrompt(text);

      if (!success || parts.length <= 1) {
        tsWarn("Split failed or returned only 1 part, sending original");
        progress.remove();
        setInputText(inputEl, text);
        await sleep(100);
        triggerSend();
        isProcessingSplit = false;
        return;
      }

      // Save split state
      await Splitter.saveSplitState({
        parts,
        currentPart: 0,
        active: true,
      });

      const progressLabel = progress.querySelector(".ts-progress-label");
      const progressFill = progress.querySelector(".ts-progress-fill");

      // Send parts sequentially
      for (let i = 0; i < parts.length; i++) {
        const partLabel = `[Part ${i + 1}/${parts.length}] `;

        if (progressLabel) progressLabel.textContent = `${i + 1}/${parts.length}`;
        if (progressFill) progressFill.style.width = `${((i + 1) / parts.length) * 100}%`;

        tsLog(`Sending Part ${i + 1}/${parts.length}`);

        setInputText(inputEl, partLabel + parts[i]);
        await sleep(300);
        triggerSend();

        // Wait for the response to finish
        if (i < parts.length - 1) {
          await waitForResponseComplete();
          await sleep(1000); // Brief pause between parts
        }
      }

      // Show completion banner
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
   * Waits for the AI response to finish streaming.
   * @param {number} [timeout=120000] - Max wait time in ms
   * @returns {Promise<void>}
   */
  function waitForResponseComplete(timeout = 120000) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let lastContentLength = 0;
      let stableCount = 0;

      const check = setInterval(() => {
        // Timeout
        if (Date.now() - startTime > timeout) {
          clearInterval(check);
          resolve();
          return;
        }

        // Check for streaming indicators
        const isStreaming =
          document.querySelector('[class*="streaming"]') ||
          document.querySelector('[class*="stop"]') ||
          document.querySelector('button[aria-label="Stop"]');

        if (!isStreaming) {
          // Double-check by seeing if content has stopped changing
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
     Watches for new messages and updates state
     ═══════════════════════════════════════════ */

  /**
   * Sets up an observer that watches for changes in the conversation
   * and updates the token count and continue buttons.
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

    tsLog("Conversation observer active");
  }

  /* ═══════════════════════════════════════════
     Helpers
     ═══════════════════════════════════════════ */

  /**
   * Returns a promise that resolves after the specified delay.
   * @param {number} ms - Milliseconds to wait
   * @returns {Promise<void>}
   */
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Safely removes an element from the DOM.
   * @param {Element} el - The element to remove
   */
  function removeElement(el) {
    if (el && el.parentElement) {
      el.remove();
    }
  }

  /* ═══════════════════════════════════════════
     Bootstrap
     ═══════════════════════════════════════════ */

  // Wait for DOM ready, then initialize
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(init, 1000));
  } else {
    setTimeout(init, 1000);
  }
})();
