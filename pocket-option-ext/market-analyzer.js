(function initMarketAnalyzer(globalScope) {
  const TIMEFRAMES = [
    { key: "3m", label: "🟢 3м", profile: "скальпинг" },
    { key: "5m", label: "🔵 5м", profile: "краткосрочный" },
    { key: "10m", label: "🟡 10м", profile: "среднесрочный" },
    { key: "15m", label: "🔴 15м", profile: "долгосрочный" },
  ];

  function detectLevels(candles) {
    const closes = candles.map((c) => c.close);
    const lows = candles.map((c) => c.low);
    const highs = candles.map((c) => c.high);
    const support = Math.min(...lows.slice(-40));
    const resistance = Math.max(...highs.slice(-40));
    const rounded = Math.round(closes[closes.length - 1] * 100) / 100;
    return { support, resistance, rounded };
  }

  function nearLevel(value, level, tolerance = 0.0025) {
    return Math.abs(value - level) / Math.max(Math.abs(level), 1e-9) <= tolerance;
  }

  function evaluateIndicators(candles) {
    const closes = candles.map((c) => c.close);
    const rsi = globalScope.POIndicators.rsi(closes, 14);
    const macd = globalScope.POIndicators.macd(closes);
    const stochastic = globalScope.POIndicators.stochastic(candles);
    const bb = globalScope.POIndicators.bollingerBands(closes);
    const reasons = [];
    let score = 0;

    if (rsi !== null && rsi < 30) {
      score += 12;
      reasons.push(`RSI ${rsi.toFixed(1)} перепродан`);
    } else if (rsi !== null && rsi > 70) {
      score -= 12;
      reasons.push(`RSI ${rsi.toFixed(1)} перекуплен`);
    }

    if (macd && macd.histogram > 0 && macd.histogramPrev <= 0) {
      score += 10;
      reasons.push("MACD: бычий разворот");
    } else if (macd && macd.histogram < 0 && macd.histogramPrev >= 0) {
      score -= 10;
      reasons.push("MACD: медвежий разворот");
    }

    if (stochastic && stochastic.k < 20) {
      score += 6;
      reasons.push(`Stochastic ${stochastic.k.toFixed(1)} (перепродан)`);
    } else if (stochastic && stochastic.k > 80) {
      score -= 6;
      reasons.push(`Stochastic ${stochastic.k.toFixed(1)} (перекуплен)`);
    }

    const lastClose = closes[closes.length - 1];
    if (bb && lastClose <= bb.lower) {
      score += 7;
      reasons.push("Bollinger: касание нижней границы");
    } else if (bb && lastClose >= bb.upper) {
      score -= 7;
      reasons.push("Bollinger: касание верхней границы");
    }

    return { weightedScore: score, reasons, rsi };
  }

  function evaluatePriceAction(candles) {
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const pattern = globalScope.POPatterns.detectPattern(last, prev);
    const reasons = [];
    let score = 0;

    if (pattern === "bullish_engulfing" || pattern === "bullish_pin_bar") {
      score += 25;
      reasons.push(`Price Action: ${pattern}`);
    } else if (pattern === "bearish_engulfing" || pattern === "bearish_pin_bar") {
      score -= 25;
      reasons.push(`Price Action: ${pattern}`);
    } else if (pattern === "doji") {
      reasons.push("Price Action: doji (неопределенность)");
    }

    return { weightedScore: score, reasons, pattern };
  }

  function evaluateLevels(candles) {
    const levels = detectLevels(candles);
    const last = candles[candles.length - 1];
    const reasons = [];
    let score = 0;

    if (nearLevel(last.low, levels.support) || nearLevel(last.close, levels.rounded)) {
      score += 20;
      reasons.push("Цена у поддержки/круглого уровня");
    }
    if (nearLevel(last.high, levels.resistance)) {
      score -= 20;
      reasons.push("Цена у сопротивления");
    }

    return { weightedScore: score, reasons, levels };
  }

  function evaluateTrend(candles) {
    const closes = candles.map((c) => c.close);
    const ema50 = globalScope.POIndicators.ema(closes, 50);
    const ema200 = globalScope.POIndicators.ema(closes, 200) ?? globalScope.POIndicators.ema(closes, 120);
    const last = closes[closes.length - 1];
    const reasons = [];
    let score = 0;

    if (ema50 && ema200 && ema50 > ema200 && last > ema50) {
      score += 20;
      reasons.push("Тренд: EMA50 > EMA200 (бычий)");
    } else if (ema50 && ema200 && ema50 < ema200 && last < ema50) {
      score -= 20;
      reasons.push("Тренд: EMA50 < EMA200 (медвежий)");
    }

    return { weightedScore: score, reasons, ema50, ema200 };
  }

  function toSignal(totalScore, methodVotes) {
    const strong = methodVotes >= 3;
    if (totalScore >= 25) return { signal: "CALL", strength: strong ? "STRONG" : "NORMAL", icon: strong ? "↑↑" : "↑" };
    if (totalScore <= -25) return { signal: "PUT", strength: strong ? "STRONG" : "NORMAL", icon: strong ? "↓↓" : "↓" };
    return { signal: "NEUTRAL", strength: "WEAK", icon: "○" };
  }

  function analyzeMarket(candles) {
    const indicatorBlock = evaluateIndicators(candles);
    const actionBlock = evaluatePriceAction(candles);
    const levelBlock = evaluateLevels(candles);
    const trendBlock = evaluateTrend(candles);

    const blocks = [indicatorBlock, actionBlock, levelBlock, trendBlock];
    const score = blocks.reduce((acc, b) => acc + b.weightedScore, 0);
    const bullishVotes = blocks.filter((b) => b.weightedScore > 0).length;
    const bearishVotes = blocks.filter((b) => b.weightedScore < 0).length;
    const alignedVotes = Math.max(bullishVotes, bearishVotes);

    const final = toSignal(score, alignedVotes);
    const reasons = blocks.flatMap((b) => b.reasons);
    if (!reasons.length) reasons.push("Нет четкого сигнала");

    return {
      ...final,
      score,
      reasons,
      diagnostics: {
        rsi: indicatorBlock.rsi,
        pattern: actionBlock.pattern,
        support: levelBlock.levels.support,
        resistance: levelBlock.levels.resistance,
      },
    };
  }

  globalScope.POMarketAnalyzer = {
    TIMEFRAMES,
    analyzeMarket,
  };
})(window);
