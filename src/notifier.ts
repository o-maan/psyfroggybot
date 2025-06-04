const TELEGRAM_API_URL = "https://api.telegram.org/bot";
const CHAT_ID = "-1002496122257";

export async function sendTelegramNotification(
  message: string,
  token?: string
): Promise<boolean> {
  const botToken = token || process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    console.error("❌ TELEGRAM_BOT_TOKEN не найден");
    return false;
  }

  const url = `${TELEGRAM_API_URL}${botToken}/sendMessage`;
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
      return true;
    } else {
      console.error("❌ Ошибка отправки уведомления:", await response.text());
      return false;
    }
  } catch (error) {
    console.error("❌ Ошибка при отправке уведомления в Telegram:", error);
    return false;
  }
}

// Предустановленные сообщения для деплойментов
export const DEPLOYMENT_MESSAGES = {
  START:
    "🚀 <b>Начат деплойнмент PSY Froggy Bot</b>\n\n📦 Ветка: main\n⏰ Время: " +
    new Date().toLocaleString("ru-RU"),

  SUCCESS:
    "✅ <b>Деплойнмент успешно завершён!</b>\n\n🎉 PSY Froggy Bot обновлён\n🌐 Домен: psy_froggy_bot.invntrm.ru\n⏰ Время: " +
    new Date().toLocaleString("ru-RU"),

  FAILURE:
    "❌ <b>Деплойнмент не удался!</b>\n\n💥 Ошибка при обновлении PSY Froggy Bot\n🔧 Требуется вмешательство\n⏰ Время: " +
    new Date().toLocaleString("ru-RU"),

  PM2_RESTART:
    "🔄 <b>PM2 процесс перезапущен</b>\n\n📊 PSY Froggy Bot: активен\n⚡ Статус: работает",

  DB_BACKUP:
    "💾 <b>Резервная копия БД создана</b>\n\n📁 Backup: froggy.db.backup." +
    new Date().toISOString().slice(0, 19).replace(/:/g, ""),
};
