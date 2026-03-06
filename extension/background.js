// Service worker for BGA Innovation Tracker extension.
// Listens for toolbar icon clicks, injects extract.js into BGA tabs,
// and POSTs extracted data to the local FastAPI server.

const SERVER_URL = "http://localhost:8787/extract";
const BADGE_CLEAR_DELAY_MS = 5000;
const FETCH_TIMEOUT_MS = 60000;
let extracting = false;

chrome.action.onClicked.addListener(async (tab) => {
  // Prevent re-injection while extraction is in progress
  if (extracting) return;

  // Check the active tab URL is a BGA game page (anchored to hostname)
  if (!tab.url || !tab.url.match(/^https?:\/\/([a-z0-9]+\.)?boardgamearena\.com\/.*[?&]table=\d/)) {
    chrome.action.setBadgeText({ text: "ERR", tabId: tab.id });
    chrome.action.setBadgeBackgroundColor({ color: "#D32F2F", tabId: tab.id });
    console.error("Not a BGA game page:", tab.url);
    clearBadgeLater(tab.id);
    return;
  }

  // Set badge to "..." while extracting
  chrome.action.setBadgeText({ text: "...", tabId: tab.id });
  chrome.action.setBadgeBackgroundColor({ color: "#1976D2", tabId: tab.id });
  extracting = true;

  try {
    // Inject extract.js into the active tab in the MAIN world (with timeout
    // so a hung BGA ajaxcall doesn't permanently block the extension)
    const extractionPromise = chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["extract.js"],
      world: "MAIN",
    });
    // Suppress unhandled rejection if extractionPromise settles after timeout
    extractionPromise.catch(() => {});
    const results = await Promise.race([
      extractionPromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Extraction timed out")), FETCH_TIMEOUT_MS)
      ),
    ]);

    const extractResult = results[0].result;

    if (!extractResult || extractResult.error) {
      const errorMsg = extractResult ? extractResult.msg : "No result from extraction";
      throw new Error("Extraction failed: " + errorMsg);
    }

    // POST extracted data to local server (with timeout)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(SERVER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        url: tab.url,
        raw_data: extractResult,
      }),
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const body = await response.text();
      throw new Error("Server error " + response.status + ": " + body);
    }

    const serverResult = await response.json();
    console.log("Pipeline complete:", serverResult);

    // Success badge
    chrome.action.setBadgeText({ text: "\u2713", tabId: tab.id });
    chrome.action.setBadgeBackgroundColor({ color: "#388E3C", tabId: tab.id });
  } catch (err) {
    console.error("BGA Innovation Tracker error:", err);
    chrome.action.setBadgeText({ text: "ERR", tabId: tab.id });
    chrome.action.setBadgeBackgroundColor({ color: "#D32F2F", tabId: tab.id });
  }

  extracting = false;
  clearBadgeLater(tab.id);
});

function clearBadgeLater(tabId) {
  setTimeout(() => {
    chrome.action.setBadgeText({ text: "", tabId: tabId });
  }, BADGE_CLEAR_DELAY_MS);
}
