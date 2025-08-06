import { Telegraf } from 'telegraf';
import { db } from './src/db.ts';

// Используем основной токен бота
const MAIN_BOT_TOKEN = '7639548256:AAH7TDYcU3v2NAUKnuEpk2qntb2TzXJU0gQ';
const bot = new Telegraf(MAIN_BOT_TOKEN);

async function sendTrophy() {
  const chatId = -1002496122257; // Основная группа обсуждений
  const channelMessageId = 53; // ID поста в канале
  const userId = 5153477378;
  
  // Тексты поддержки
  const supportTexts = [
    'Спасибо, что поделился 💚',
    'Понимаю тебя 🤗',
    'Это действительно непросто 💛',
    'Ты молодец, что проговариваешь это 🌱',
    'Твои чувства важны 💙',
    'Слышу тебя 🤍',
    'Благодарю за доверие 🌿'
  ];
  
  const supportText = supportTexts[Math.floor(Math.random() * supportTexts.length)];
  
  // Формируем сообщение
  const responseText = `<i>${supportText}</i>

2. <b>Плюшки для лягушки</b> (ситуация+эмоция)
<blockquote>Что сегодня вызвало интерес? Даже микро-моменты важны 😌</blockquote>`;
  
  try {
    console.log(`🚀 Отправляем в чат ${chatId}, тред ${channelMessageId}`);
    
    const result = await bot.telegram.sendMessage(chatId, responseText, {
      parse_mode: 'HTML',
      message_thread_id: channelMessageId
    });
    
    console.log('✅ Плюшки отправлены успешно\!', result.message_id);
    
    // Обновляем статус в БД
    const update = db.query(`
      UPDATE interactive_posts
      SET task2_completed = 1
      WHERE channel_message_id = ?
    `);
    update.run(channelMessageId);
    
    console.log('✅ Статус обновлен в БД');
    
  } catch (error: any) {
    console.error('❌ Ошибка:', error.message);
    console.error('Response:', error.response);
  }
  
  process.exit(0);
}

sendTrophy();
