const symbolInput = document.getElementById('symbol');
const horizonSelect = document.getElementById('horizon');
const thresholdInput = document.getElementById('threshold');
const analyzeBtn = document.getElementById('analyze');
const resultEl = document.getElementById('result');

const SIGNAL_CLASS = {
  CALL: 'signal-call',
  PUT: 'signal-put',
  WAIT: 'signal-wait'
};

function setResult(text, signalType) {
  resultEl.classList.remove('muted', 'signal-call', 'signal-put', 'signal-wait');
  if (SIGNAL_CLASS[signalType]) {
    resultEl.classList.add(SIGNAL_CLASS[signalType]);
  } else {
    resultEl.classList.add('muted');
  }
  resultEl.textContent = text;
}

async function loadSettings() {
  const data = await chrome.storage.sync.get({
    symbol: 'BTCUSDT',
    horizon: '3m',
    threshold: 70
  });

  symbolInput.value = data.symbol;
  horizonSelect.value = data.horizon;
  thresholdInput.value = data.threshold;
}

async function saveSettings() {
  await chrome.storage.sync.set({
    symbol: symbolInput.value.trim().toUpperCase(),
    horizon: horizonSelect.value,
    threshold: Number(thresholdInput.value)
  });
}

analyzeBtn.addEventListener('click', async () => {
  try {
    await saveSettings();
    setResult('Analyzing market checks...', null);

    const response = await chrome.runtime.sendMessage({
      type: 'ANALYZE_SIGNAL',
      payload: {
        symbol: symbolInput.value.trim().toUpperCase(),
        horizon: horizonSelect.value,
        threshold: Number(thresholdInput.value)
      }
    });

    if (!response?.ok) {
      setResult(`Error: ${response?.error || 'Unknown error'}`, null);
      return;
    }

    const { signal, confidence, score, reasons, price } = response.data;

    const lines = [
      `Signal: ${signal}`,
      `Confidence: ${confidence}%`,
      `Score: ${score}`,
      `Last price: ${price}`,
      'Checks:',
      ...reasons.map((r) => `• ${r}`)
    ];

    setResult(lines.join('\n'), signal);

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'SHOW_SIGNAL_BANNER',
        payload: { signal, confidence }
      });
    }
  } catch (err) {
    setResult(`Error: ${err.message}`, null);
  }
});

loadSettings();
