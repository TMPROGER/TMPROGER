(function initIndicators(globalScope) {
  function ema(values, period) {
    if (values.length < period) return null;
    const k = 2 / (period + 1);
    let prev = values.slice(0, period).reduce((acc, v) => acc + v, 0) / period;
    for (let i = period; i < values.length; i += 1) {
      prev = values[i] * k + prev * (1 - k);
    }
    return prev;
  }

  function sma(values, period) {
    if (values.length < period) return null;
    const part = values.slice(-period);
    return part.reduce((acc, v) => acc + v, 0) / period;
  }

  function rsi(closes, period = 14) {
    if (closes.length < period + 1) return null;
    let gains = 0;
    let losses = 0;
    for (let i = closes.length - period; i < closes.length; i += 1) {
      const diff = closes[i] - closes[i - 1];
      if (diff >= 0) gains += diff;
      else losses += Math.abs(diff);
    }
    if (losses === 0) return 100;
    const rs = gains / losses;
    return 100 - 100 / (1 + rs);
  }

  function macd(closes, fast = 12, slow = 26, signalPeriod = 9) {
    if (closes.length < slow + signalPeriod) return null;
    const macdSeries = closes.map((_, idx) => {
      const sub = closes.slice(0, idx + 1);
      const f = ema(sub, fast);
      const s = ema(sub, slow);
      return f !== null && s !== null ? f - s : null;
    }).filter((value) => value !== null);

    const macdLine = macdSeries[macdSeries.length - 1];
    const signalLine = ema(macdSeries, signalPeriod);
    if (signalLine === null) return null;
    const histogram = macdLine - signalLine;

    const prevMacdLine = macdSeries[macdSeries.length - 2] ?? macdLine;
    const prevSignalSlice = macdSeries.slice(0, -1);
    const prevSignalLine = ema(prevSignalSlice, signalPeriod) ?? signalLine;

    return {
      line: macdLine,
      signal: signalLine,
      histogram,
      histogramPrev: prevMacdLine - prevSignalLine,
    };
  }

  function stochastic(candles, period = 14) {
    if (candles.length < period) return null;
    const window = candles.slice(-period);
    const highs = window.map((c) => c.high);
    const lows = window.map((c) => c.low);
    const close = window[window.length - 1].close;

    const highMax = Math.max(...highs);
    const lowMin = Math.min(...lows);
    const k = highMax === lowMin ? 50 : ((close - lowMin) / (highMax - lowMin)) * 100;
    return { k };
  }

  function bollingerBands(closes, period = 20, stdMultiplier = 2) {
    const mid = sma(closes, period);
    if (mid === null) return null;
    const slice = closes.slice(-period);
    const variance = slice.reduce((acc, v) => acc + (v - mid) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    return {
      middle: mid,
      upper: mid + stdMultiplier * std,
      lower: mid - stdMultiplier * std,
    };
  }

  globalScope.POIndicators = {
    ema,
    sma,
    rsi,
    macd,
    stochastic,
    bollingerBands,
  };
})(window);
