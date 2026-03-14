# Pocket Option Signal Assistant (Chrome Extension)

This project contains a Chrome extension that helps a trader monitor short-term market momentum and generate **3-minute** and **5-minute** directional signals.

> ⚠️ This extension is educational and analytical only. It cannot guarantee profit and should not be treated as financial advice.

## Features

- Works on `pocketoption.com`
- Popup controls to:
  - choose a symbol (for example `BTCUSDT`)
  - choose signal horizon (`3m` or `5m`)
  - set confidence threshold
  - trigger a fresh analysis
- Runs **multiple checks** before returning a signal:
  - trend via EMA(9) vs EMA(21)
  - momentum via RSI(14)
  - MACD line vs signal line
  - direction of last candles
  - volatility sanity check (ATR)
- Provides score, confidence and textual rationale
- Shows signal states: `CALL`, `PUT`, or `WAIT`

## Installation

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository folder.

## Usage

1. Open Pocket Option in a tab.
2. Open extension popup.
3. Set symbol and horizon (`3m` or `5m`).
4. Click **Analyze now**.
5. Wait for confidence to pass threshold; otherwise extension returns `WAIT`.

## Files

- `manifest.json` — extension manifest (MV3)
- `popup.html` / `popup.js` / `styles.css` — popup UI
- `background.js` — market fetch + indicator engine + signal scoring
- `content.js` — optional on-page info banner on Pocket Option

