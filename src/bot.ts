import { Telegraf } from 'telegraf';
import { config } from 'dotenv';
import { Scheduler } from './scheduler';
import { addUser, updateUserResponse } from './db';

// Загружаем переменные окружения
config();

// Создаем экземпляр бота
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN || '');

// Создаем планировщик
const scheduler = new Scheduler(bot);

// Обработка команды /start
bot.command('start', async (ctx) => {
  const chatId = ctx.chat.id;
  const username = ctx.from?.username || 'unknown';
  
  // Добавляем пользователя в базу
  addUser(chatId, username);
  
  // Добавляем пользователя в планировщик
  scheduler.addUser(chatId);
  
  await ctx.reply(
    'Привет! Я буду отправлять тебе ежедневные сообщения с картинками в 19:30. ' +
    'Если ты не ответишь, я напомню тебе через 1.5 часа!'
  );
});


// Обработка команды /test
bot.command('test', async (ctx) => {
  const chatId = ctx.chat.id;
  console.log('🔍 TEST COMMAND - Chat ID:', chatId);
  await scheduler.sendDailyMessage(chatId);
});

// Обработка команды /sendnow
bot.command('sendnow', async (ctx) => {
  const chatId = ctx.chat.id;
  const targetTime = new Date();
  targetTime.setHours(15, 38, 0, 0);
  
  scheduler.scheduleOneTimeMessage(chatId, targetTime);
  await ctx.reply('Сообщение будет отправлено в 15:38!');
});

// Обработка команды /fro
bot.command('fro', async (ctx) => {
  const chatId = ctx.chat.id;
  await scheduler.sendDailyMessage(chatId);
});

// Обработка текстовых сообщений
bot.on('text', async (ctx) => {
  const chatId = ctx.chat.id;
  const responseTime = new Date().toISOString();
  
  // Обновляем время ответа пользователя
  updateUserResponse(chatId, responseTime);
  
  // Очищаем напоминание
  scheduler.clearReminder(chatId);
  
  console.log('🔍 Chat ID: ' + chatId + '\n');
  
  await ctx.reply('Спасибо за ответ! 😊');
}); 

// Запускаем бота
bot.launch()
  console.log('\n🚀 Бот успешно запущен!\n📱 Для остановки нажмите Ctrl+C\n');
  // Запускаем планировщик
  scheduler.startDailySchedule();

// Обработка завершения работы
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM')); 