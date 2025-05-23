import { Telegraf } from 'telegraf';
import { getMessage } from './messages';
import { saveMessage, updateMessageResponse, getUserResponseStats } from './db';
import fs from 'fs';
import path from 'path';

const HOURS = 60 * 60 * 1000;

export class Scheduler {
  private bot: Telegraf;
  private reminderTimeouts: Map<number, NodeJS.Timeout> = new Map();
  private users: Set<number> = new Set();
  private currentImageIndex: number = 0;
  private imageFiles: string[] = [];
  private readonly CHANNEL_ID = -1002405993986;
  private readonly REMINDER_USER_ID = 5153477378;

  constructor(bot: Telegraf) {
    this.bot = bot;
    this.loadImages();
  }

  // Загрузить список картинок при старте
  private loadImages() {
    const imagesDir = path.join(process.cwd(), 'images');
    const files = fs.readdirSync(imagesDir);
    this.imageFiles = files
      .filter(file => 
        file.toLowerCase().endsWith('.jpg') || 
        file.toLowerCase().endsWith('.jpeg') || 
        file.toLowerCase().endsWith('.png')
      )
      .map(file => path.join(imagesDir, file));
    
    console.log('📸 Загружено картинок:', this.imageFiles.length);
    console.log('📸 Список картинок:', this.imageFiles);
  }

  // Получить следующую картинку по кругу
  private getNextImage(): string {
    const image = this.imageFiles[this.currentImageIndex];
    console.log('🔄 Текущий индекс картинки:', this.currentImageIndex);
    console.log('🖼️ Выбрана картинка:', image);
    
    this.currentImageIndex = (this.currentImageIndex + 1) % this.imageFiles.length;
    return image;
  }

  // Добавить пользователя в список рассылки
  addUser(chatId: number) {
    this.users.add(chatId);
  }

  // Отправить сообщение в канал
  async sendDailyMessage(chatId: number) {
    try {
      console.log('📤 Начинаю отправку сообщения в канал');
      console.log('📤 ID канала:', this.CHANNEL_ID);
      
      const message = getMessage();
      console.log('📤 Текст сообщения:', message);
      
      const imagePath = this.getNextImage();
      console.log('📤 Путь к картинке:', imagePath);
      
      // Отправляем фото с подписью в канал
      console.log('📤 Пытаюсь отправить фото в канал...');
      await this.bot.telegram.sendPhoto(this.CHANNEL_ID, { source: imagePath }, { 
        caption: message,
        parse_mode: 'Markdown'
      });
      console.log('✅ Сообщение успешно отправлено в канал');
      
      // Сохраняем время отправки
      const sentTime = new Date().toISOString();
      saveMessage(chatId, message, sentTime);

      // Устанавливаем напоминание через 1.5 часа
      this.setReminder(chatId, sentTime);
    } catch (error) {
      console.error('❌ Ошибка при отправке сообщения:', error);
      console.error('❌ Детали ошибки:', JSON.stringify(error, null, 2));
    }
  }

  // Установить напоминание
  setReminder(chatId: number, sentBotMsgTime: string) {
    const timeout = setTimeout(async () => {
      const stats = getUserResponseStats(chatId);
      if (!stats || !stats.last_response_time || new Date(stats.last_response_time) < new Date(sentBotMsgTime)) {
        await this.bot.telegram.sendMessage(
          this.REMINDER_USER_ID,
          'Эй! Ты не ответил на моё предыдущее сообщение в канале. Как дела?'
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