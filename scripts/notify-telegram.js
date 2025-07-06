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
      // Получаем commit message используя git. Поддерживаем как Node (child_process.execSync), так и Bun (Bun.spawnSync)
      let commitMsg;
      try {
        // Если это среда Bun, используем Bun.spawnSync
        if (typeof Bun !== "undefined" && Bun.spawnSync) {
          const result = Bun.spawnSync({
            cmd: ["git", "log", "-1", "--pretty=%B", process.env.GITHUB_SHA],
            stdout: "pipe",
            stderr: "pipe",
          });
          if (result.exitCode === 0) {
            commitMsg = new TextDecoder().decode(result.stdout).trim();
          } else {
            throw new Error(new TextDecoder().decode(result.stderr));
          }
        } else {
          // Обычный Node.js runtime
          const { execSync } = require("child_process");
          commitMsg = execSync(`git log -1 --pretty=%B ${process.env.GITHUB_SHA}`, { encoding: "utf8" }).trim();
        }
      } catch (innerErr) {
        throw innerErr;
      }
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

// Функция для экранирования HTML
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Отправляем уведомление
(async () => {
  const commitMsg = escapeHtml(await getCommitMessage());
  
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