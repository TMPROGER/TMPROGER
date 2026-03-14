const API_BASE = "https://api.binance.com/api/v3/klines";

function normalizeToBinancePair(symbol) {
  const clean = (symbol || "EURUSD").toUpperCase().replace(/[^A-Z]/g, "");
  if (clean.endsWith("USDT")) return clean;
  if (clean.length === 6 && clean.endsWith("USD")) {
    return `${clean.slice(0, 3)}USDT`;
  }
  return "EURUSDT";
}

async function fetchCandles({ symbol, interval, limit = 120 }) {
  const pair = normalizeToBinancePair(symbol);
  const url = new URL(API_BASE);
  url.searchParams.set("symbol", pair);
  url.searchParams.set("interval", interval);
  url.searchParams.set("limit", String(limit));

  const response = await fetch(url.toString());
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Binance error ${response.status}: ${text}`);
  }

  const rows = await response.json();
  return rows.map((candle) => ({
    time: candle[0],
    open: Number(candle[1]),
    high: Number(candle[2]),
    low: Number(candle[3]),
    close: Number(candle[4]),
    volume: Number(candle[5]),
  }));
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("po-refresh-hint", { periodInMinutes: 0.2 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "po-refresh-hint") return;
  chrome.tabs.query({ url: ["*://*.pocketoption.com/*", "*://pocketoption.com/*"] }, (tabs) => {
    tabs.forEach((tab) => {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { type: "SIGNAL_TICK" }, () => {
          void chrome.runtime.lastError;
        });
      }
    });
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "FETCH_CANDLES") return false;

  fetchCandles(message.payload)
    .then((candles) => sendResponse({ ok: true, candles }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});
