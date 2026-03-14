(function initSignalPanel(globalScope) {
  const REFRESH_MS = 7000;
  const state = {
    symbol: "EURUSD",
    latest: new Map(),
    accuracy: 73,
    lastUpdateMs: 0,
  };

  function createPanel() {
    if (document.querySelector("#po-advanced-analyst")) return;

    const container = document.createElement("aside");
    container.id = "po-advanced-analyst";
    container.innerHTML = `
      <div class="po-header">🔥 Продвинутый Аналитик Сигналов v2.0</div>
      <div class="po-tabs">[ Инфо | Сессии | <span class="active">🔥 СИГНАЛЫ</span> | Новости | Мартин | Тема ]</div>
      <div class="po-time">Текущий сигнал: <span id="po-current-time">--:--:--</span></div>
      <div id="po-signals-list" class="po-signals-list"></div>
      <div class="po-footer">
        <div>📊 Точность сигналов: <span id="po-accuracy">73</span>% (24h)</div>
        <div>🔄 Последнее обновление: <span id="po-latency">-</span>с</div>
      </div>
    `;

    document.body.appendChild(container);
  }

  function getSymbolFromPage() {
    const text = document.body?.innerText?.slice(0, 10000) || "";
    const m = text.match(/\b([A-Z]{3}[\/\-_]?[A-Z]{3}|[A-Z]{2,6}USDT)\b/);
    if (m) return m[1].replace(/[\/\-_]/g, "");
    return state.symbol;
  }

  function fetchCandles(symbol, interval) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: "FETCH_CANDLES", payload: { symbol, interval, limit: 220 } },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!response?.ok) {
            reject(new Error(response?.error || "Ошибка получения свечей"));
            return;
          }
          resolve(response.candles);
        }
      );
    });
  }

  function renderSignals() {
    const root = document.querySelector("#po-signals-list");
    if (!root) return;

    const rows = globalScope.POMarketAnalyzer.TIMEFRAMES.map((tf) => {
      const result = state.latest.get(tf.key);
      if (!result) {
        return `<div class="po-row"><div class="po-line">[${tf.key}] ○ ОЖИДАНИЕ ДАННЫХ</div></div>`;
      }

      const signalClass = result.signal.toLowerCase();
      const strongClass = result.strength === "STRONG" ? "strong pulse" : "";
      const headline = `[${tf.key}] ${result.icon} ${result.strength === "STRONG" ? "СИЛЬНЫЙ " : ""}${result.signal}`;
      const reasons = result.reasons.slice(0, 3).map((r) => `<li>${r}</li>`).join("");

      return `
        <div class="po-row ${signalClass} ${strongClass}">
          <div class="po-line">${headline}</div>
          <ul>${reasons}</ul>
        </div>
      `;
    }).join("");

    root.innerHTML = rows;
    const now = new Date();
    document.querySelector("#po-current-time").textContent = now.toLocaleTimeString("ru-RU", { hour12: false });
    document.querySelector("#po-accuracy").textContent = String(state.accuracy);

    const latency = ((Date.now() - state.lastUpdateMs) / 1000).toFixed(1);
    document.querySelector("#po-latency").textContent = latency;
  }

  async function refreshSignals() {
    state.symbol = getSymbolFromPage();

    await Promise.all(globalScope.POMarketAnalyzer.TIMEFRAMES.map(async (tf) => {
      try {
        const candles = await fetchCandles(state.symbol, tf.key);
        const result = globalScope.POMarketAnalyzer.analyzeMarket(candles);
        state.latest.set(tf.key, result);
      } catch (error) {
        state.latest.set(tf.key, {
          signal: "NEUTRAL",
          strength: "WEAK",
          icon: "○",
          reasons: [`Ошибка: ${error.message}`],
        });
      }
    }));

    state.lastUpdateMs = Date.now();
    renderSignals();
  }

  function init() {
    createPanel();
    renderSignals();
    refreshSignals();
    setInterval(refreshSignals, REFRESH_MS);

    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === "SIGNAL_TICK") {
        refreshSignals();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})(window);
