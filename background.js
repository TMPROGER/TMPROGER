const TIMEFRAME_BY_HORIZON = {
  '3m': '1m',
  '5m': '1m'
};

function ema(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i += 1) {
    prev = values[i] * k + prev * (1 - k);
  }
  return prev;
}

function rsi(values, period = 14) {
  if (values.length <= period) return null;
  let gains = 0;
  let losses = 0;

  for (let i = values.length - period; i < values.length; i += 1) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

function macd(values) {
  const ema12 = ema(values, 12);
  const ema26 = ema(values, 26);
  if (ema12 === null || ema26 === null) return null;

  const line = ema12 - ema26;
  const macdSeries = [];
  for (let i = 26; i <= values.length; i += 1) {
    const slice = values.slice(0, i);
    const e12 = ema(slice, 12);
    const e26 = ema(slice, 26);
    if (e12 !== null && e26 !== null) {
      macdSeries.push(e12 - e26);
    }
  }

  const signal = ema(macdSeries, 9);
  if (signal === null) return null;

  return { line, signal, histogram: line - signal };
}

function atr(candles, period = 14) {
  if (candles.length <= period) return null;
  const tr = [];
  for (let i = 1; i < candles.length; i += 1) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    tr.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }

  if (tr.length < period) return null;
  return tr.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function scoreSignal(candles, horizon, threshold) {
  const closes = candles.map((c) => c.close);
  const currentPrice = closes[closes.length - 1];
  const reasons = [];
  let callScore = 0;
  let putScore = 0;

  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  if (ema9 !== null && ema21 !== null) {
    if (ema9 > ema21) {
      callScore += 2;
      reasons.push('EMA9 above EMA21 (up-trend bias)');
    } else {
      putScore += 2;
      reasons.push('EMA9 below EMA21 (down-trend bias)');
    }
  }

  const currentRsi = rsi(closes, 14);
  if (currentRsi !== null) {
    if (currentRsi > 55 && currentRsi < 75) {
      callScore += 2;
      reasons.push(`RSI supportive for CALL (${currentRsi.toFixed(1)})`);
    } else if (currentRsi < 45 && currentRsi > 25) {
      putScore += 2;
      reasons.push(`RSI supportive for PUT (${currentRsi.toFixed(1)})`);
    } else {
      reasons.push(`RSI neutral/extreme (${currentRsi.toFixed(1)})`);
    }
  }

  const m = macd(closes);
  if (m) {
    if (m.line > m.signal && m.histogram > 0) {
      callScore += 2;
      reasons.push('MACD line above signal (bullish momentum)');
    } else if (m.line < m.signal && m.histogram < 0) {
      putScore += 2;
      reasons.push('MACD line below signal (bearish momentum)');
    } else {
      reasons.push('MACD mixed');
    }
  }

  const recent = closes.slice(-5);
  let up = 0;
  let down = 0;
  for (let i = 1; i < recent.length; i += 1) {
    if (recent[i] > recent[i - 1]) up += 1;
    if (recent[i] < recent[i - 1]) down += 1;
  }
  if (up >= 3) {
    callScore += 1;
    reasons.push('Recent candles mostly rising');
  }
  if (down >= 3) {
    putScore += 1;
    reasons.push('Recent candles mostly falling');
  }

  const currentAtr = atr(candles, 14);
  if (currentAtr !== null) {
    const atrPct = (currentAtr / currentPrice) * 100;
    if (atrPct < 0.05) {
      reasons.push('Low volatility detected, reduced confidence');
      callScore -= 1;
      putScore -= 1;
    } else {
      reasons.push(`Volatility acceptable (ATR ${atrPct.toFixed(3)}%)`);
    }
  }

  const total = Math.max(callScore, putScore);
  const opposite = Math.min(callScore, putScore);
  const rawConfidence = Math.max(0, Math.min(100, Math.round(((total - opposite + 1) / 8) * 100)));

  let signal = 'WAIT';
  if (callScore > putScore) signal = 'CALL';
  if (putScore > callScore) signal = 'PUT';

  if (rawConfidence < threshold) {
    reasons.push(`Confidence below threshold ${threshold}% => WAIT`);
    signal = 'WAIT';
  }

  reasons.push(`Horizon: ${horizon}. Multiple checks completed.`);

  return {
    signal,
    confidence: rawConfidence,
    score: `${callScore}:${putScore}`,
    reasons,
    price: currentPrice.toFixed(2)
  };
}

async function fetchCandles(symbol, interval) {
  const url = new URL('https://api.binance.com/api/v3/klines');
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('interval', interval);
  url.searchParams.set('limit', '120');

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Market API error: ${res.status}`);
  }

  const data = await res.json();
  return data.map((item) => ({
    openTime: item[0],
    open: Number(item[1]),
    high: Number(item[2]),
    low: Number(item[3]),
    close: Number(item[4]),
    volume: Number(item[5])
  }));
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'ANALYZE_SIGNAL') return;

  (async () => {
    try {
      const symbol = message.payload?.symbol || 'BTCUSDT';
      const horizon = message.payload?.horizon || '3m';
      const threshold = Number(message.payload?.threshold ?? 70);
      const interval = TIMEFRAME_BY_HORIZON[horizon] || '1m';

      const candles = await fetchCandles(symbol, interval);
      const result = scoreSignal(candles, horizon, threshold);

      sendResponse({ ok: true, data: result });
    } catch (err) {
      sendResponse({ ok: false, error: err.message || 'Unknown analysis error' });
    }
  })();

  return true;
});
