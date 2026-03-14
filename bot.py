import asyncio
import base64
import json
import logging
import os
import re
from dataclasses import dataclass
from io import BytesIO
from statistics import mean
from typing import Any

import httpx
from dotenv import load_dotenv
from telegram import Update
from telegram.constants import ChatAction
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)


load_dotenv()
logging.basicConfig(
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger("image_bot")


@dataclass(slots=True)
class Settings:
    telegram_bot_token: str
    image_api_key: str
    image_api_base_url: str
    image_model: str
    image_response_format: str
    image_size: str
    signal_interval: str
    signal_range: str

    @classmethod
    def from_env(cls) -> "Settings":
        telegram_bot_token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
        image_api_key = os.getenv("IMAGE_API_KEY", "").strip()

        if not telegram_bot_token:
            raise ValueError("Не задан TELEGRAM_BOT_TOKEN")
        if not image_api_key:
            raise ValueError("Не задан IMAGE_API_KEY")

        return cls(
            telegram_bot_token=telegram_bot_token,
            image_api_key=image_api_key,
            image_api_base_url=os.getenv("IMAGE_API_BASE_URL", "https://api.openai.com/v1").rstrip("/"),
            image_model=os.getenv("IMAGE_MODEL", "gpt-image-1").strip(),
            image_response_format=os.getenv("IMAGE_RESPONSE_FORMAT", "png").strip().lower(),
            image_size=os.getenv("IMAGE_SIZE", "1024x1024").strip(),
            signal_interval=os.getenv("SIGNAL_INTERVAL", "15m").strip(),
            signal_range=os.getenv("SIGNAL_RANGE", "5d").strip(),
        )


class ImageClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._http = httpx.AsyncClient(timeout=120)

    async def aclose(self) -> None:
        await self._http.aclose()

    async def generate(self, prompt: str) -> bytes:
        payload: dict[str, Any] = {
            "model": self._settings.image_model,
            "prompt": prompt,
            "size": self._settings.image_size,
            "response_format": self._settings.image_response_format,
        }

        response = await self._http.post(
            f"{self._settings.image_api_base_url}/images/generations",
            headers={
                "Authorization": f"Bearer {self._settings.image_api_key}",
                "Content-Type": "application/json",
            },
            content=json.dumps(payload),
        )

        if response.status_code >= 400:
            raise RuntimeError(f"Ошибка API изображений {response.status_code}: {response.text}")

        data = response.json()
        entries = data.get("data", [])
        if not entries:
            raise RuntimeError("API изображений вернул пустой ответ")

        first = entries[0]
        b64 = first.get("b64_json")
        if b64:
            return base64.b64decode(b64)

        url = first.get("url")
        if url:
            img = await self._http.get(url)
            img.raise_for_status()
            return img.content

        raise RuntimeError("В ответе API нет b64_json или url")


class MarketClient:
    def __init__(self) -> None:
        self._http = httpx.AsyncClient(timeout=30)

    async def aclose(self) -> None:
        await self._http.aclose()

    async def get_closes(self, yahoo_symbol: str, interval: str, period_range: str) -> list[float]:
        endpoint = f"https://query1.finance.yahoo.com/v8/finance/chart/{yahoo_symbol}"
        response = await self._http.get(
            endpoint,
            params={"interval": interval, "range": period_range},
            headers={"User-Agent": "Mozilla/5.0"},
        )
        response.raise_for_status()
        data = response.json()
        result = data.get("chart", {}).get("result", [])
        if not result:
            raise RuntimeError("Не удалось получить рыночные данные")

        closes = result[0].get("indicators", {}).get("quote", [{}])[0].get("close", [])
        values = [float(v) for v in closes if isinstance(v, (float, int))]
        if len(values) < 60:
            raise RuntimeError("Недостаточно данных для анализа")
        return values


def sma(values: list[float], period: int) -> float:
    return mean(values[-period:])


def rsi(values: list[float], period: int = 14) -> float:
    gains: list[float] = []
    losses: list[float] = []
    for i in range(-period, 0):
        change = values[i] - values[i - 1]
        if change >= 0:
            gains.append(change)
            losses.append(0.0)
        else:
            gains.append(0.0)
            losses.append(abs(change))

    avg_gain = mean(gains)
    avg_loss = mean(losses)
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def parse_symbol_to_yahoo(text: str) -> str | None:
    upper = text.upper()
    known_fiat = {"USD", "EUR", "GBP", "JPY", "AUD", "NZD", "CAD", "CHF", "SEK", "NOK", "RUB", "CNY"}

    usdt = re.search(r"\b([A-Z]{2,6})USDT\b", upper)
    if usdt:
        return f"{usdt.group(1)}-USD"

    crypto_usd = re.search(r"\b([A-Z]{2,6})[-/_ ]USD\b", upper)
    if crypto_usd:
        return f"{crypto_usd.group(1)}-USD"

    forex = re.search(r"\b([A-Z]{3})[\-\/_ ]?([A-Z]{3})\b", upper)
    if forex:
        base, quote = forex.groups()
        if base in known_fiat and quote in known_fiat and base != quote:
            return f"{base}{quote}=X"

    if re.fullmatch(r"[A-Z]{6}=X", upper.strip()):
        return upper.strip()

    return None


def analyze_signal(closes: list[float]) -> dict[str, str | float]:
    last_price = closes[-1]
    sma20 = sma(closes, 20)
    sma50 = sma(closes, 50)
    current_rsi = rsi(closes, 14)

    trend_score = 0
    if last_price > sma20:
        trend_score += 1
    if sma20 > sma50:
        trend_score += 1
    if 50 <= current_rsi <= 70:
        trend_score += 1

    if trend_score >= 2:
        signal = "ПОКУПКА"
    else:
        short_score = 0
        if last_price < sma20:
            short_score += 1
        if sma20 < sma50:
            short_score += 1
        if 30 <= current_rsi <= 50:
            short_score += 1
        signal = "ПРОДАЖА" if short_score >= 2 else "ОЖИДАНИЕ"

    volatility = abs(closes[-1] - closes[-6])
    stop_loss = max(last_price - volatility, 0)
    take_profit = last_price + (volatility * 1.8)

    confidence = min(95, max(35, int((abs(last_price - sma20) / max(last_price, 1e-9)) * 2000) + 45))

    return {
        "signal": signal,
        "price": round(last_price, 6),
        "sma20": round(sma20, 6),
        "sma50": round(sma50, 6),
        "rsi": round(current_rsi, 2),
        "stop_loss": round(stop_loss, 6),
        "take_profit": round(take_profit, 6),
        "confidence": confidence,
    }


def build_help(settings: Settings) -> str:
    return (
        "Я генерирую изображения и даю торговые сигналы по валютам/крипте.\n\n"
        "Команды:\n"
        "/start — приветствие\n"
        "/help — справка\n"
        "/model — текущая модель изображений\n"
        "/signal [SYMBOL] — анализ и сигнал (например: /signal EURUSD или /signal BTCUSDT)\n"
        "/active — показать текущий автоматически распознанный актив\n\n"
        f"Интервал сигналов по умолчанию: {settings.signal_interval}, диапазон: {settings.signal_range}.\n"
        "Если вы отправите текст с тикером (например EURUSD), бот запомнит его как текущий актив."
    )


def format_signal_message(yahoo_symbol: str, analysis: dict[str, str | float]) -> str:
    return (
        f"Актив: {yahoo_symbol}\n"
        f"Сигнал: {analysis['signal']}\n"
        f"Текущая цена: {analysis['price']}\n"
        f"SMA20: {analysis['sma20']} | SMA50: {analysis['sma50']}\n"
        f"RSI(14): {analysis['rsi']}\n"
        f"Stop-loss: {analysis['stop_loss']}\n"
        f"Take-profit: {analysis['take_profit']}\n"
        f"Уверенность: {analysis['confidence']}%\n\n"
        "⚠️ Это автоматический технический анализ, не финансовая рекомендация."
    )


async def start_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    settings: Settings = context.application.bot_data["settings"]
    await update.message.reply_text(
        "Привет! Я бот для генерации изображений и торговых сигналов.\n"
        "Отправь промпт для картинки или используй /signal для анализа рынка.\n\n"
        + build_help(settings)
    )


async def help_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    settings: Settings = context.application.bot_data["settings"]
    await update.message.reply_text(build_help(settings))


async def model_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    settings: Settings = context.application.bot_data["settings"]
    await update.message.reply_text(
        f"Текущая модель: {settings.image_model}\n"
        f"Размер по умолчанию: {settings.image_size}\n"
        f"Формат: {settings.image_response_format.upper()}"
    )


async def active_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    active = context.chat_data.get("active_symbol")
    if not active:
        await update.message.reply_text("Пока нет активного символа. Отправьте, например: EURUSD или BTCUSDT.")
        return
    await update.message.reply_text(f"Текущий актив для анализа: {active}")


async def signal_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return

    settings: Settings = context.application.bot_data["settings"]
    market_client: MarketClient = context.application.bot_data["market_client"]

    raw_arg = " ".join(context.args).strip() if context.args else ""
    yahoo_symbol = parse_symbol_to_yahoo(raw_arg) if raw_arg else context.chat_data.get("active_symbol")
    if not yahoo_symbol:
        yahoo_symbol = "EURUSD=X"

    context.chat_data["active_symbol"] = yahoo_symbol

    await context.bot.send_chat_action(chat_id=update.effective_chat.id, action=ChatAction.TYPING)

    try:
        closes = await market_client.get_closes(yahoo_symbol, settings.signal_interval, settings.signal_range)
        analysis = analyze_signal(closes)
        await update.message.reply_text(format_signal_message(yahoo_symbol, analysis))
    except Exception as exc:  # noqa: BLE001
        logger.exception("Ошибка анализа сигнала")
        await update.message.reply_text(f"Ошибка анализа сигнала: {exc}")


async def prompt_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message or not update.message.text:
        return

    prompt = update.message.text.strip()
    if not prompt:
        await update.message.reply_text("Пустой запрос. Отправьте промпт или тикер.")
        return

    detected_symbol = parse_symbol_to_yahoo(prompt)
    if detected_symbol:
        context.chat_data["active_symbol"] = detected_symbol

    lowered = prompt.lower()
    wants_signal = any(keyword in lowered for keyword in ["сигнал", "signal", "анализ", "analysis"])
    if wants_signal:
        settings: Settings = context.application.bot_data["settings"]
        market_client: MarketClient = context.application.bot_data["market_client"]
        yahoo_symbol = detected_symbol or context.chat_data.get("active_symbol") or "EURUSD=X"

        await context.bot.send_chat_action(chat_id=update.effective_chat.id, action=ChatAction.TYPING)
        try:
            closes = await market_client.get_closes(yahoo_symbol, settings.signal_interval, settings.signal_range)
            analysis = analyze_signal(closes)
            await update.message.reply_text(format_signal_message(yahoo_symbol, analysis))
            return
        except Exception as exc:  # noqa: BLE001
            logger.exception("Ошибка анализа сигнала")
            await update.message.reply_text(f"Ошибка анализа сигнала: {exc}")
            return

    image_client: ImageClient = context.application.bot_data["image_client"]
    await context.bot.send_chat_action(chat_id=update.effective_chat.id, action=ChatAction.UPLOAD_PHOTO)

    try:
        image_bytes = await image_client.generate(prompt)
        photo = BytesIO(image_bytes)
        photo.name = "generated.png"
        await update.message.reply_photo(photo=photo, caption=f"Промпт: {prompt[:900]}")
    except Exception as exc:  # noqa: BLE001
        logger.exception("Ошибка генерации изображения")
        await update.message.reply_text(f"Ошибка генерации: {exc}")


async def post_init(application: Application) -> None:
    logger.info("Бот запущен")


async def post_shutdown(application: Application) -> None:
    image_client: ImageClient = application.bot_data["image_client"]
    market_client: MarketClient = application.bot_data["market_client"]
    await image_client.aclose()
    await market_client.aclose()


async def main() -> None:
    settings = Settings.from_env()
    image_client = ImageClient(settings)
    market_client = MarketClient()

    app = (
        Application.builder()
        .token(settings.telegram_bot_token)
        .post_init(post_init)
        .post_shutdown(post_shutdown)
        .build()
    )

    app.bot_data["settings"] = settings
    app.bot_data["image_client"] = image_client
    app.bot_data["market_client"] = market_client

    app.add_handler(CommandHandler("start", start_handler))
    app.add_handler(CommandHandler("help", help_handler))
    app.add_handler(CommandHandler("model", model_handler))
    app.add_handler(CommandHandler("signal", signal_handler))
    app.add_handler(CommandHandler("active", active_handler))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, prompt_handler))

    await app.initialize()
    await app.start()
    await app.updater.start_polling(drop_pending_updates=True)

    try:
        while True:
            await asyncio.sleep(3600)
    finally:
        await app.updater.stop()
        await app.stop()
        await app.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
