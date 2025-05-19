import { Telegraf } from 'telegraf';
import { getMessage } from './messages';
import { saveMessage, updateMessageResponse, getUserResponseStats } from './db';
import fs from 'fs';
import path from 'path';

export class Scheduler {
  private bot: Telegraf;
  private reminderTimeouts: Map<number, NodeJS.Timeout> = new Map();
  private users: Set<number> = new Set();

  constructor(bot: Telegraf) {
    this.bot = bot;
  }

  // Добавить пользователя в список рассылки
  addUser(chatId: number) {
    this.users.add(chatId);
  }

  // Получить случайную картинку из папки
  private getRandomImage(): string {
    const imagesDir = path.join(process.cwd(), 'images');
    const files = fs.readdirSync(imagesDir);
    const imageFiles = files.filter(file => 
      file.endsWith('.jpg') || file.endsWith('.png') || file.endsWith('.jpeg')
    );
    return path.join(imagesDir, imageFiles[Math.floor(Math.random() * imageFiles.length)]);
  }

  // Отправить сообщение пользователю
  async sendDailyMessage(chatId: number) {
    try {
      console.log('📤 SENDING MESSAGE - Chat ID:', chatId);
      const message = getMessage();
      const imagePath = this.getRandomImage();
      
      // Отправляем фото с подписью
      await this.bot.telegram.sendPhoto(chatId, { source: imagePath }, { caption: message });
      console.log('✅ MESSAGE SENT - Chat ID:', chatId);
      
      // Сохраняем время отправки
      const sentTime = new Date().toISOString();
      saveMessage(chatId, message, sentTime);

      // Устанавливаем напоминание через 1.5 часа
      this.setReminder(chatId, sentTime);
    } catch (error) {
      console.error('❌ ERROR SENDING MESSAGE - Chat ID:', chatId, error);
    }
  }

  // Установить напоминание
  private setReminder(chatId: number, sentTime: string) {
    const timeout = setTimeout(async () => {
      const stats = getUserResponseStats(chatId);
      if (!stats || !stats.last_response_time) {
        await this.bot.telegram.sendMessage(
          chatId,
          'Эй! Ты не ответил на моё предыдущее сообщение. Как дела?'
        );
      }
    }, 1.5 * 60 * 60 * 1000); // 1.5 часа

    this.reminderTimeouts.set(chatId, timeout);
  }

  // Запустить ежедневную рассылку
  startDailySchedule() {
    // Устанавливаем время отправки (19:30)
    const scheduleTime = new Date();
    scheduleTime.setHours(19, 30, 0, 0);

    // Если текущее время больше 19:30, планируем на следующий день
    if (new Date() > scheduleTime) {
      scheduleTime.setDate(scheduleTime.getDate() + 1);
    }

    // Вычисляем задержку до следующей отправки
    const delay = scheduleTime.getTime() - new Date().getTime();

    // Планируем отправку
    setTimeout(() => {
      // Отправляем сообщения всем пользователям
      this.users.forEach(chatId => this.sendDailyMessage(chatId));
      // Планируем следующую отправку через 24 часа
      setInterval(() => {
        this.users.forEach(chatId => this.sendDailyMessage(chatId));
      }, 24 * 60 * 60 * 1000);
    }, delay);
  }

  // Очистить напоминание
  clearReminder(chatId: number) {
    const timeout = this.reminderTimeouts.get(chatId);
    if (timeout) {
      clearTimeout(timeout);
      this.reminderTimeouts.delete(chatId);
    }
  }

  // Добавить разовую отправку сообщения
  scheduleOneTimeMessage(chatId: number, targetTime: Date) {
    const now = new Date();
    const delay = targetTime.getTime() - now.getTime();
    
    if (delay > 0) {
      setTimeout(() => {
        this.sendDailyMessage(chatId);
      }, delay);
    }
  }
} 