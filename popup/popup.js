/**
 * TokenSaver — Popup Controller
 *
 * Manages the popup UI: loading/saving settings, displaying stats,
 * showing current tab status, and handling toggle interactions.
 */

(function () {
  "use strict";

  /* ═══════════════════════════════════════════
     DOM Elements
     ═══════════════════════════════════════════ */

  const els = {
    statusDot: document.getElementById("status-dot"),
    statusText: document.getElementById("status-text"),
    contextSection: document.getElementById("context-section"),
    contextPercent: document.getElementById("context-percent"),
    contextFill: document.getElementById("context-fill"),
    contextLabel: document.getElementById("context-label"),
    statCompressions: document.getElementById("stat-compressions"),
    statTokensSaved: document.getElementById("stat-tokens-saved"),
    statContinuations: document.getElementById("stat-continuations"),

    // Toggle inputs
    toggleCompressor: document.getElementById("input-compressor"),
    toggleContinueButton: document.getElementById("input-continueButton"),
    toggleMemoryTrimmer: document.getElementById("input-memoryTrimmer"),
    toggleTaskSplitter: document.getElementById("input-taskSplitter"),
  };

  /* ═══════════════════════════════════════════
     Initialization
     ═══════════════════════════════════════════ */

  /**
   * Initializes the popup: loads settings, detects current tab,
   * fetches stats, and sets up event listeners.
   */
  async function init() {
    await loadSettings();
    await detectCurrentTab();
    await loadStats();
    setupToggleListeners();
  }

  /* ═══════════════════════════════════════════
     Settings Management
     ═══════════════════════════════════════════ */

  /**
   * Loads saved settings from chrome.storage.local and updates toggle states.
   */
  async function loadSettings() {
    try {
      const result = await chrome.storage.local.get("settings");
      const settings = result.settings || {
        compressor: true,
        continueButton: true,
        memoryTrimmer: true,
        taskSplitter: true,
      };

      // Update UI
      els.toggleCompressor.checked = settings.compressor;
      els.toggleContinueButton.checked = settings.continueButton;
      els.toggleMemoryTrimmer.checked = settings.memoryTrimmer;
      els.toggleTaskSplitter.checked = settings.taskSplitter;
    } catch (error) {
      console.error("[TokenSaver Popup] Failed to load settings:", error);
    }
  }

  /**
   * Saves settings to chrome.storage.local.
   * @param {Object} settings - The settings object
   */
  async function saveSettings(settings) {
    try {
      await chrome.storage.local.set({ settings });
      console.log("[TokenSaver Popup] Settings saved:", settings);
    } catch (error) {
      console.error("[TokenSaver Popup] Failed to save settings:", error);
    }
  }

  /**
   * Reads the current state of all toggles and returns a settings object.
   * @returns {Object} Current settings from toggle states
   */
  function getCurrentToggleState() {
    return {
      compressor: els.toggleCompressor.checked,
      continueButton: els.toggleContinueButton.checked,
      memoryTrimmer: els.toggleMemoryTrimmer.checked,
      taskSplitter: els.toggleTaskSplitter.checked,
    };
  }

  /**
   * Sets up change event listeners on all toggle switches.
   * Each toggle saves immediately on change.
   */
  function setupToggleListeners() {
    const toggles = [
      els.toggleCompressor,
      els.toggleContinueButton,
      els.toggleMemoryTrimmer,
      els.toggleTaskSplitter,
    ];

    for (const toggle of toggles) {
      toggle.addEventListener("change", () => {
        const settings = getCurrentToggleState();
        saveSettings(settings);
      });
    }
  }

  /* ═══════════════════════════════════════════
     Tab Detection
     ═══════════════════════════════════════════ */

  /**
   * Detects the current active tab and updates the status bar.
   */
  async function detectCurrentTab() {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tab || !tab.url) {
        setStatus("inactive", "Not on an AI tab");
        hideContextSection();
        return;
      }

      const url = tab.url;

      if (url.includes("claude.ai")) {
        setStatus("active", "Active on Claude.ai");
        showContextSection();
      } else if (url.includes("chatgpt.com")) {
        setStatus("active", "Active on ChatGPT");
        showContextSection();
      } else {
        setStatus("inactive", "Not on an AI tab");
        hideContextSection();
      }
    } catch (error) {
      console.error("[TokenSaver Popup] Failed to detect tab:", error);
      setStatus("inactive", "Unable to detect tab");
      hideContextSection();
    }
  }

  /**
   * Updates the status bar UI.
   * @param {"active"|"inactive"} status - The status state
   * @param {string} text - The status text to display
   */
  function setStatus(status, text) {
    els.statusDot.className = `status-dot ${status === "active" ? "active" : ""}`;
    els.statusText.textContent = text;
  }

  /**
   * Shows the context health section.
   */
  function showContextSection() {
    els.contextSection.style.display = "block";
  }

  /**
   * Hides the context health section.
   */
  function hideContextSection() {
    els.contextSection.style.display = "none";
  }

  /* ═══════════════════════════════════════════
     Stats Display
     ═══════════════════════════════════════════ */

  /**
   * Loads today's stats from the background script and updates the UI.
   */
  async function loadStats() {
    try {
      const stats = await chrome.runtime.sendMessage({ type: "GET_STATS" });

      if (stats) {
        els.statCompressions.textContent = stats.compressions || 0;
        els.statTokensSaved.textContent = `~${formatNumber(stats.tokensSaved || 0)}`;
        els.statContinuations.textContent = stats.continuations || 0;
      }
    } catch (error) {
      console.error("[TokenSaver Popup] Failed to load stats:", error);
    }
  }

  /**
   * Formats a number for display (e.g., 4200 → "4,200").
   * @param {number} num - The number to format
   * @returns {string} Formatted number string
   */
  function formatNumber(num) {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + "M";
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + "K";
    }
    return num.toString();
  }

  /* ═══════════════════════════════════════════
     Bootstrap
     ═══════════════════════════════════════════ */

  document.addEventListener("DOMContentLoaded", init);
})();
