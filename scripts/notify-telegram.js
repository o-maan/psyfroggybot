#!/usr/bin/env node

// Скрипт для отправки уведомлений в Telegram из GitHub Actions
const TELEGRAM_API_URL = "https://api.telegram.org/bot";
const CHAT_ID = "-1002496122257";

async function sendTelegramNotification(message, token) {
  if (!token) {
    console.error("❌ TELEGRAM_BOT_TOKEN не найден");
    process.exit(1);
  }

  const url = `${TELEGRAM_API_URL}${token}/sendMessage`;
  const payload = {
    chat_id: CHAT_ID,
    text: message,
    parse_mode: "HTML",
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      console.log("✅ Уведомление успешно отправлено в Telegram");
      process.exit(0);
    } else {
      const errorText = await response.text();
      console.error("❌ Ошибка отправки уведомления:", errorText);
      process.exit(1);
    }
  } catch (error) {
    console.error("❌ Ошибка при отправке уведомления в Telegram:", error);
    process.exit(1);
  }
}

// Получаем аргументы командной строки
const messageType = process.argv[2];
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const currentTime = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });

// Предустановленные сообщения
const messages = {
  start: `🚀 <b>Начат деплойнмент PSY Froggy Bot</b>

📦 Ветка: main
🔧 Сервер: Digital Ocean
⏰ Время: ${currentTime}`,

  success: `✅ <b>Деплойнмент успешно завершён!</b>

🎉 PSY Froggy Bot обновлён
🌐 Домен: psy_froggy_bot.invntrm.ru
🔄 PM2: перезапущен
⏰ Время: ${currentTime}`,

  failure: `❌ <b>Деплойнмент не удался!</b>

💥 Ошибка при обновлении PSY Froggy Bot
🔧 Требуется вмешательство
📊 Проверьте логи GitHub Actions
⏰ Время: ${currentTime}`,
};

// Проверяем тип сообщения
if (!messageType || !messages[messageType]) {
  console.error("❌ Неверный тип сообщения. Доступные: start, success, failure");
  process.exit(1);
}

// Отправляем уведомление
sendTelegramNotification(messages[messageType], botToken); 