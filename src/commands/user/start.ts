import { Telegraf, Markup } from 'telegraf';
import { Scheduler } from '../../scheduler';
import { botLogger } from '../../logger';
import { addUser, updateUserName, updateUserGender, getUserByChatId, updateOnboardingState, enableDMMode } from '../../db';
import { InputFile } from 'telegraf/types';
import path from 'path';
import { sendToUser } from '../../utils/send-to-user';

// Обработка команды /start
export function registerStartCommand(bot: Telegraf, scheduler: Scheduler) {
  bot.command('start', async ctx => {
    const chatId = ctx.chat.id;
    const userId = ctx.from?.id || 0;
    const username = ctx.from?.username || '';
    botLogger.info({ userId, chatId }, `📱 Команда /start от пользователя ${userId}`);

    // 🆕 Включаем режим личных сообщений (ЛС) для пользователя
    enableDMMode(chatId);
    botLogger.info({ userId, chatId }, '✅ Режим ЛС включен для пользователя');

    // Проверяем, если это Алекс (ID: 5153477378), автоматически устанавливаем имя и пол
    if (userId === 5153477378) {
      addUser(chatId, username, 'Алекс', 'male');
      updateUserName(chatId, 'Алекс');
      updateUserGender(chatId, 'male');
      botLogger.info({ userId, name: 'Алекс', gender: 'male' }, '✅ Автоматически установлено имя и пол для Алекса');

      // Добавляем Алекса в планировщик (так как он пропускает онбординг)
      await scheduler.addUserToTimezone(chatId, 'Europe/Moscow');
      botLogger.info({ userId, chatId }, '✅ Алекс добавлен в планировщик');

      // Для Алекса показываем старое сообщение (без онбординга)
      await sendToUser(
        bot,
        chatId,
        userId,
        'Привет, Алекс! Я бот-лягушка 🐸\n\n' +
          'Рад тебя видеть! Продолжаем работать вместе 💚'
      );
      return;
    }

    // Проверяем, если это Оля (ID: 476561547), автоматически устанавливаем имя и пол
    if (userId === 476561547) {
      addUser(chatId, username, 'Оля', 'female');
      updateUserName(chatId, 'Оля');
      updateUserGender(chatId, 'female');
      botLogger.info({ userId, name: 'Оля', gender: 'female' }, '✅ Автоматически установлено имя и пол для Оли');

      // Добавляем Олю в планировщик (так как она пропускает онбординг)
      await scheduler.addUserToTimezone(chatId, 'Europe/Belgrade');
      botLogger.info({ userId, chatId }, '✅ Оля добавлена в планировщик');

      // Для Оли показываем старое сообщение (без онбординга)
      await sendToUser(
        bot,
        chatId,
        userId,
        'Привет, Оля! Я бот-лягушка 🐸\n\n' +
          'Рада снова тебя видеть! Продолжаем работать вместе 💚'
      );
      return;
    }

    // Для всех остальных пользователей
    addUser(chatId, username);

    // Проверяем, прошел ли пользователь уже онбординг
    const user = getUserByChatId(chatId);

    if (user && user.name) {
      // Пользователь уже зарегистрирован и имеет имя
      await sendToUser(
        bot,
        chatId,
        userId,
        'Привет, {userName}! 🐸\n\nРад снова тебя видеть! Продолжаем работать вместе 💚'
      );
      return;
    }

    // Начинаем онбординг: отправляем приветственное сообщение с картинкой
    const imagePath = path.join(process.cwd(), 'images', 'hi.png');
    const welcomeText = `Квак! 🐸
Я твой лягушка-психолог

Я здесь, чтобы помогать тебе быть чуть ближе к себе, замечать свои чувства и делать жизнь лучше 💫

Весь день я буду рядом, чтобы выслушать, а каждый вечер – присылать небольшие задания. Работа со своим внутренним миром может изменить многое 😊

Готов попробовать?`;

    try {
      await ctx.replyWithPhoto(
        { source: imagePath } as InputFile,
        {
          caption: welcomeText,
          ...Markup.inlineKeyboard([
            [Markup.button.callback('Вперед 🚀', 'onboarding_start')]
          ])
        }
      );

      // Устанавливаем состояние онбординга
      updateOnboardingState(chatId, 'waiting_start');
      botLogger.info({ userId, chatId }, '✅ Отправлено приветственное сообщение, ожидаем нажатие кнопки');
    } catch (error) {
      botLogger.error({ error, userId, chatId }, '❌ Ошибка отправки приветственного сообщения');

      // Fallback: отправляем текст без картинки
      await sendToUser(
        bot,
        chatId,
        userId,
        welcomeText,
        Markup.inlineKeyboard([
          [Markup.button.callback('Вперед 🚀', 'onboarding_start')]
        ])
      );
      updateOnboardingState(chatId, 'waiting_start');
    }
  });
}