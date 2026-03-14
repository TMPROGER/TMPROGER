(function initPatterns(globalScope) {
  function candleBody(c) {
    return Math.abs(c.close - c.open);
  }

  function isDoji(candle) {
    const range = Math.max(candle.high - candle.low, 1e-9);
    return candleBody(candle) / range < 0.1;
  }

  function isPinBar(candle) {
    const range = Math.max(candle.high - candle.low, 1e-9);
    const upperWick = candle.high - Math.max(candle.open, candle.close);
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;
    const body = candleBody(candle);

    const bullish = lowerWick / range > 0.55 && body / range < 0.3;
    const bearish = upperWick / range > 0.55 && body / range < 0.3;

    if (bullish) return "bullish_pin_bar";
    if (bearish) return "bearish_pin_bar";
    return null;
  }

  function detectEngulfing(previous, current) {
    const prevBull = previous.close > previous.open;
    const prevBear = previous.close < previous.open;
    const currBull = current.close > current.open;
    const currBear = current.close < current.open;

    if (prevBear && currBull && current.close >= previous.open && current.open <= previous.close) {
      return "bullish_engulfing";
    }
    if (prevBull && currBear && current.open >= previous.close && current.close <= previous.open) {
      return "bearish_engulfing";
    }
    return null;
  }

  function detectPattern(last, prev) {
    if (!last || !prev) return "none";
    const engulfing = detectEngulfing(prev, last);
    if (engulfing) return engulfing;
    if (isDoji(last)) return "doji";
    return isPinBar(last) || "none";
  }

  globalScope.POPatterns = {
    detectPattern,
    isDoji,
    isPinBar,
  };
})(window);
