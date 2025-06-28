#!/usr/bin/env bun

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

// Получаем последнее commit сообщение из переменной окружения или git
async function getCommitMessage() {
  if (process.env.GITHUB_SHA) {
    try {
      // В GitHub Actions можно получить commit message через git log
      const { execSync } = require('child_process');
      const commitMsg = execSync(`git log -1 --pretty=%B ${process.env.GITHUB_SHA}`, { encoding: 'utf8' }).trim();
      return `${commitMsg} (${process.env.GITHUB_SHA.substring(0, 7)})`;
    } catch (error) {
      console.warn('Не удалось получить commit message:', error.message);
      return `Изменения (${process.env.GITHUB_SHA.substring(0, 7)})`;
    }
  }
  return 'Локальное развертывание';
}


// Проверяем тип сообщения
if (!messageType || !['start', 'success', 'failure'].includes(messageType)) {
  console.error("❌ Неверный тип сообщения. Доступные: start, success, failure");
  process.exit(1);
}

// Отправляем уведомление
(async () => {
  const commitMsg = await getCommitMessage();
  
  // Обновляем сообщения с актуальным commit message
  const messages = {
    start: `🚀 <b>Начат деплой PSY Froggy Bot</b>

📦 Ветка: main
🔧 Сервер: Digital Ocean
📝 Изменения: ${commitMsg}
⏰ Время: ${currentTime}`,

    success: `✅ <b>Деплой успешно завершён!</b>

🎉 PSY Froggy Bot обновлён
🌐 Домен: psy-froggy-bot.invntrm.ru
🔄 PM2: перезапущен
📝 Изменения: ${commitMsg}
⏰ Время: ${currentTime}`,

    failure: `❌ <b>Деплой не удался!</b>

💥 Ошибка при обновлении PSY Froggy Bot
🔧 Требуется вмешательство
📊 Проверьте логи GitHub Actions
📝 Попытка применить: ${commitMsg}
⏰ Время: ${currentTime}`,
  };
  
  await sendTelegramNotification(messages[messageType], botToken);
})(); 