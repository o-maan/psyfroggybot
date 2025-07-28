#!/usr/bin/env bun

import { config } from 'dotenv';
import { Scheduler } from './src/scheduler';
import { CalendarService } from './src/calendar';
import { Telegraf } from 'telegraf';

// Загружаем переменные окружения
config();

async function test() {
  console.log('🧪 Тестирование новой интерактивной логики бота');
  
  // Создаем экземпляр бота
  const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN || '');
  const calendarService = new CalendarService();
  const scheduler = new Scheduler(bot, calendarService);
  
  // Проверяем, что мы в тестовом режиме
  if (!scheduler.isTestBot()) {
    console.log('❌ Это не тестовый бот! Отмените операцию для безопасности.');
    process.exit(1);
  }
  
  console.log('✅ Работаем с тестовым ботом');
  
  const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);
  
  if (!adminChatId) {
    console.log('❌ ADMIN_CHAT_ID не установлен в .env');
    process.exit(1);
  }
  
  console.log(`📤 Отправляем интерактивное сообщение для chatId: ${adminChatId}`);
  
  try {
    // Отправляем интерактивное сообщение с флагом ручной команды
    await scheduler.sendInteractiveDailyMessage(adminChatId, true);
    console.log('✅ Интерактивное сообщение успешно отправлено!');
    console.log('🔍 Проверьте канал - должен появиться пост с изображением и текстом "Переходи в комментарии и продолжим 😉"');
    console.log('💬 В комментариях должно появиться первое задание с кнопкой пропуска');
  } catch (error) {
    console.error('❌ Ошибка при отправке:', error);
  }
  
  // Ждем немного перед завершением
  setTimeout(() => {
    console.log('✅ Тест завершен');
    process.exit(0);
  }, 5000);
}

// Запускаем тест
test().catch(console.error);