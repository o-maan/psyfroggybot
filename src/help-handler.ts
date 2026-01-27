import { Telegraf, Markup } from 'telegraf';
import { botLogger } from './logger';
import { sendToUser } from './utils/send-to-user';
import { saveHelpStatistics } from './db';
import fs from 'fs';

/**
 * HelpHandler - обработчик интерактивной логики команды /help
 *
 * Логика работы:
 * 1. Пользователь вызывает /help в ЛС
 * 2. Бот показывает картинку с предупреждением + 4 кнопки типов тревоги
 * 3. При выборе типа тревоги:
 *    - Сохраняем статистику в БД
 *    - Показываем соответствующий сценарий помощи
 * 4. Пользователь идет по сценарию с кнопками "Дальше"
 */
export class HelpHandler {
  private bot: Telegraf;
  private chatId: number; // ID чата для отправки сообщений (всегда ЛС)
  private userId: number; // ID пользователя для БД

  // Путь к картинке тревоги
  private static readonly ANXIETY_IMAGE_PATH = '/Users/alexandermekhonoshin/code/psyfroggybot/images/help тревога.png';

  constructor(bot: Telegraf, chatId: number, userId: number) {
    this.bot = bot;
    this.chatId = chatId;
    this.userId = userId;
  }

  /**
   * Отправить стартовое сообщение с выбором типа тревоги
   */
  async sendInitialMessage(): Promise<void> {
    try {
      // Читаем картинку
      const imageBuffer = fs.readFileSync(HelpHandler.ANXIETY_IMAGE_PATH);

      const text = `*С тобой общается лягуха-бот, если чувствуешь, что тебе нужна помощь, пожалуйста, обратись к специалисту или в скорую помощь - твоя жизнь важна❣️*

Если ничего критичного - выбери, что сейчас больше подходит под твою ситуацию`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('Острая тревога 🚨😵', 'help:acute')],
        [Markup.button.callback('Мысли не отпускают 😵‍💫', 'help:thoughts')],
        [Markup.button.callback('Фоновая тревога 🫠', 'help:background')],
        [Markup.button.callback('Тревога с людьми/в местах 👩🏻‍🤝‍👨🏼✈️', 'help:people_places')],
      ]);

      await this.bot.telegram.sendPhoto(this.chatId, { source: imageBuffer }, {
        caption: text,
        parse_mode: 'Markdown',
        ...keyboard,
      });

      botLogger.info({ userId: this.userId, chatId: this.chatId }, '✅ Отправлено стартовое сообщение /help');
    } catch (e) {
      const error = e as Error;
      botLogger.error(
        { error: error.message, stack: error.stack, userId: this.userId, chatId: this.chatId },
        '❌ Ошибка отправки стартового сообщения /help'
      );
      throw error;
    }
  }

  /**
   * Обработать выбор "Острая тревога"
   */
  async handleAcuteAnxiety(callbackQueryId: string): Promise<void> {
    try {
      // Сохраняем статистику
      saveHelpStatistics(this.userId, 'acute');

      // Подтверждаем нажатие кнопки
      await this.bot.telegram.answerCbQuery(callbackQueryId);

      // Отправляем текст с предупреждением
      const text = `Постарайся дышать спокойнее и проверь самое главное ⬇

*❣️ Вызови скорую СРАЗУ, если есть ХОТЯ БЫ ОДНО из:*
1. Боль в груди (давящая/жгущая), отдающая в руку, шею, челюсть, спину
2. Одышка + потливость + тошнота
3. Слабость в лице/руке/ноге (особенно с одной стороны)
4. Невнятная речь, потеря сознания/равновесия, сильное головокружение, двоение в глазах

*❗ Если сомневаешься - вызывай скорую. Лучше перестраховаться*`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('Вызвал скорую 🚨', 'help:acute_called')],
        [Markup.button.callback('Нет ничего из списка ☑️', 'help:acute_no_symptoms')],
      ]);

      await sendToUser(this.bot, this.chatId, this.userId, text, {
        parse_mode: 'Markdown',
        ...keyboard,
      });

      botLogger.info({ userId: this.userId }, '✅ Обработан выбор "Острая тревога"');
    } catch (e) {
      const error = e as Error;
      botLogger.error(
        { error: error.message, stack: error.stack, userId: this.userId },
        '❌ Ошибка обработки "Острая тревога"'
      );
      throw error;
    }
  }

  /**
   * Обработать нажатие "Вызвал скорую"
   */
  async handleAcuteCalled(callbackQueryId: string): Promise<void> {
    try {
      await this.bot.telegram.answerCbQuery(callbackQueryId);

      const text = 'Есть признаки из списка?';
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('Да', 'help:acute_symptoms_yes')],
        [Markup.button.callback('Нет', 'help:acute_symptoms_no')],
      ]);

      await sendToUser(this.bot, this.chatId, this.userId, text, keyboard);

      botLogger.info({ userId: this.userId }, '✅ Обработано "Вызвал скорую"');
    } catch (e) {
      const error = e as Error;
      botLogger.error(
        { error: error.message, stack: error.stack, userId: this.userId },
        '❌ Ошибка обработки "Вызвал скорую"'
      );
      throw error;
    }
  }

  /**
   * Обработать "Да" на вопрос о признаках (пользователь вызвал скорую и есть признаки)
   */
  async handleAcuteSymptomsYes(callbackQueryId: string): Promise<void> {
    try {
      await this.bot.telegram.answerCbQuery(callbackQueryId);

      // Шаг 1: Обеспечь доступ воздуха
      const text = `Ты молодец! Вот, что ты можешь сделать до приезда скорой:

*1. Обеспечь доступ воздуха*
Открой окно, сними тесную одежду, расстегни воротник`;

      const keyboard = Markup.inlineKeyboard([[Markup.button.callback('Дальше', 'help:acute_step2')]]);

      await sendToUser(this.bot, this.chatId, this.userId, text, {
        parse_mode: 'Markdown',
        ...keyboard,
      });

      botLogger.info({ userId: this.userId }, '✅ Начат сценарий инструкций (Шаг 1)');
    } catch (e) {
      const error = e as Error;
      botLogger.error(
        { error: error.message, stack: error.stack, userId: this.userId },
        '❌ Ошибка отправки Шага 1'
      );
      throw error;
    }
  }

  /**
   * Шаг 2: НЕ ходи и НЕ ложись
   */
  async handleAcuteStep2(callbackQueryId: string): Promise<void> {
    try {
      await this.bot.telegram.answerCbQuery(callbackQueryId);

      const text = `*2. НЕ ходи и НЕ ложись* (особенно на спину)
Сядь на стул или кресло лучше с подлокотниками, ноги положи на небольшую подставку - это снижает нагрузку на сердце`;

      const keyboard = Markup.inlineKeyboard([[Markup.button.callback('Дальше', 'help:acute_step3')]]);

      await sendToUser(this.bot, this.chatId, this.userId, text, {
        parse_mode: 'Markdown',
        ...keyboard,
      });

      botLogger.info({ userId: this.userId }, '✅ Отправлен Шаг 2');
    } catch (e) {
      const error = e as Error;
      botLogger.error(
        { error: error.message, stack: error.stack, userId: this.userId },
        '❌ Ошибка отправки Шага 2'
      );
      throw error;
    }
  }

  /**
   * Шаг 3: Не ешь и не пей
   */
  async handleAcuteStep3(callbackQueryId: string): Promise<void> {
    try {
      await this.bot.telegram.answerCbQuery(callbackQueryId);

      const text = `*3. Не ешь и не пей*
Не принимай препараты "на всякий случай" - это может навредить`;

      const keyboard = Markup.inlineKeyboard([[Markup.button.callback('Дальше', 'help:acute_step4')]]);

      await sendToUser(this.bot, this.chatId, this.userId, text, {
        parse_mode: 'Markdown',
        ...keyboard,
      });

      botLogger.info({ userId: this.userId }, '✅ Отправлен Шаг 3');
    } catch (e) {
      const error = e as Error;
      botLogger.error(
        { error: error.message, stack: error.stack, userId: this.userId },
        '❌ Ошибка отправки Шага 3'
      );
      throw error;
    }
  }

  /**
   * Шаг 4: Дыши как можно спокойнее
   */
  async handleAcuteStep4(callbackQueryId: string): Promise<void> {
    try {
      await this.bot.telegram.answerCbQuery(callbackQueryId);

      const text = `*4. Дыши как можно спокойнее* - не глубоко и не часто
Твоя задача - сохранять покой`;

      const keyboard = Markup.inlineKeyboard([[Markup.button.callback('Завершить', 'help:acute_final')]]);

      await sendToUser(this.bot, this.chatId, this.userId, text, {
        parse_mode: 'Markdown',
        ...keyboard,
      });

      botLogger.info({ userId: this.userId }, '✅ Отправлен Шаг 4');
    } catch (e) {
      const error = e as Error;
      botLogger.error(
        { error: error.message, stack: error.stack, userId: this.userId },
        '❌ Ошибка отправки Шага 4'
      );
      throw error;
    }
  }

  /**
   * Финальное сообщение сценария
   */
  async handleAcuteFinal(callbackQueryId: string): Promise<void> {
    try {
      await this.bot.telegram.answerCbQuery(callbackQueryId);

      const text = `Помощь уже едет 🚑
Не делай резких движений, постарайся не двигаться. Просто продолжай дышать`;

      await sendToUser(this.bot, this.chatId, this.userId, text);

      botLogger.info({ userId: this.userId }, '✅ Завершен сценарий "Острая тревога" с признаками');
    } catch (e) {
      const error = e as Error;
      botLogger.error(
        { error: error.message, stack: error.stack, userId: this.userId },
        '❌ Ошибка отправки финального сообщения'
      );
      throw error;
    }
  }

  /**
   * Обработать "Нет ничего из списка" или "Нет" на вопрос о признаках
   * Начало сценария панической атаки
   */
  async handleNoSymptoms(callbackQueryId: string): Promise<void> {
    try {
      await this.bot.telegram.answerCbQuery(callbackQueryId);

      const text = `Если нет ничего из списка - на самом деле это хорошие новости! Значит, вероятнее всего, мы имеем дело с сильной тревогой или панической атакой.

_Что тут хорошего?_
*Паническая атака, как бы пугающе ни выглядела, не опасна для жизни ❣️*`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('Признаки панической атаки', 'help:panic_signs')],
        [Markup.button.callback('Что делать?', 'help:panic_what_to_do')],
      ]);

      await sendToUser(this.bot, this.chatId, this.userId, text, {
        parse_mode: 'Markdown',
        ...keyboard,
      });

      botLogger.info({ userId: this.userId }, '✅ Обработано "Нет симптомов" - начало сценария ПА');
    } catch (e) {
      const error = e as Error;
      botLogger.error(
        { error: error.message, stack: error.stack, userId: this.userId },
        '❌ Ошибка обработки "Нет симптомов"'
      );
      throw error;
    }
  }

  /**
   * Признаки панической атаки
   */
  async handlePanicSigns(callbackQueryId: string): Promise<void> {
    try {
      await this.bot.telegram.answerCbQuery(callbackQueryId);

      const text = `*Признаки панической атаки* (ПА):
• Сердце колотится, но без боли в груди
• «Не хватает воздуха», но дыхание свободное _(нет хрипов или посинения)_
• Страх смерти, но тело в порядке - можешь говорить, стоять, двигаться
• Онемение/покалывание в руках/лице _(от гипервентиляции - частое поверхностное дыхание, при нормализации дыхания должно пройти в течение 1-5 мин)_
• Началось внезапно «на ровном месте» или после стресса - не при физической нагрузке

📌 *Паническая атака НЕ вызывает обмороков, падений, нарушений речи или зрения. ПА длится 5–15 мин*`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('Что делать?', 'help:panic_what_to_do')],
      ]);

      await sendToUser(this.bot, this.chatId, this.userId, text, {
        parse_mode: 'Markdown',
        ...keyboard,
      });

      botLogger.info({ userId: this.userId }, '✅ Отправлены признаки панической атаки');
    } catch (e) {
      const error = e as Error;
      botLogger.error(
        { error: error.message, stack: error.stack, userId: this.userId },
        '❌ Ошибка отправки признаков ПА'
      );
      throw error;
    }
  }

  /**
   * Что делать? - Этап 1: Возвращение контроля (дыхание)
   */
  async handlePanicWhatToDo(callbackQueryId: string): Promise<void> {
    try {
      await this.bot.telegram.answerCbQuery(callbackQueryId);

      const text = `Этап 1: *ВОЗВРАЩЕНИЕ КОНТРОЛЯ*
Сейчас мы немного замедлим дыхание

*Делай вдох через нос на 4 счета*
*Выдох через рот на 6-8 счетов*
Выдох должен быть длиннее вдоха`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('Дальше', 'help:panic_step2')],
      ]);

      await sendToUser(this.bot, this.chatId, this.userId, text, {
        parse_mode: 'Markdown',
        ...keyboard,
      });

      botLogger.info({ userId: this.userId }, '✅ Начат сценарий ПА - Этап 1');
    } catch (e) {
      const error = e as Error;
      botLogger.error(
        { error: error.message, stack: error.stack, userId: this.userId },
        '❌ Ошибка отправки Этапа 1 ПА'
      );
      throw error;
    }
  }

  /**
   * Этап 1 продолжение: объяснение про дыхание
   */
  async handlePanicStep2(callbackQueryId: string): Promise<void> {
    try {
      await this.bot.telegram.answerCbQuery(callbackQueryId);

      const text = `Дыхание - единственная часть нервной системы, которой ты можешь управлять сознательно
Продолжай дышать
Нужно 2-5 мин, чтобы запустить успокаивающий эффект`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('Дальше', 'help:panic_step3')],
      ]);

      await sendToUser(this.bot, this.chatId, this.userId, text, {
        parse_mode: 'Markdown',
        ...keyboard,
      });

      botLogger.info({ userId: this.userId }, '✅ Этап 1 ПА - продолжение');
    } catch (e) {
      const error = e as Error;
      botLogger.error(
        { error: error.message, stack: error.stack, userId: this.userId },
        '❌ Ошибка отправки продолжения Этапа 1 ПА'
      );
      throw error;
    }
  }

  /**
   * Этап 2: Понимание
   */
  async handlePanicStep3(callbackQueryId: string): Promise<void> {
    try {
      await this.bot.telegram.answerCbQuery(callbackQueryId);

      const text = `Этап 2: *ПОНИМАНИЕ*
Твое тело думает что ты в опасности и включает защиту: сердце бьется быстрее, дыхание учащается, мышцы напрягаются

Скажи себе: *"Это паника. Она не опасна. Я в безопасности. Это ложная тревога мозга. И это пройдет"*`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('Дальше', 'help:panic_step4')],
      ]);

      await sendToUser(this.bot, this.chatId, this.userId, text, {
        parse_mode: 'Markdown',
        ...keyboard,
      });

      botLogger.info({ userId: this.userId }, '✅ Этап 2 ПА - Понимание');
    } catch (e) {
      const error = e as Error;
      botLogger.error(
        { error: error.message, stack: error.stack, userId: this.userId },
        '❌ Ошибка отправки Этапа 2 ПА'
      );
      throw error;
    }
  }

  /**
   * Этап 3: Телесное заземление
   */
  async handlePanicStep4(callbackQueryId: string): Promise<void> {
    try {
      await this.bot.telegram.answerCbQuery(callbackQueryId);

      const text = `Этап 3: *ТЕЛЕСНОЕ ЗАЗЕМЛЕНИЕ*
Теперь нужно вернуть связь с телом

Обхвати себя руками и медленно, с легким надавливанием, пройдись руками от плеч до локтей и обратно.
Повтори 3-4 раза. Почувствуй свое тело`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('Дальше', 'help:panic_step5')],
      ]);

      await sendToUser(this.bot, this.chatId, this.userId, text, {
        parse_mode: 'Markdown',
        ...keyboard,
      });

      botLogger.info({ userId: this.userId }, '✅ Этап 3 ПА - Телесное заземление');
    } catch (e) {
      const error = e as Error;
      botLogger.error(
        { error: error.message, stack: error.stack, userId: this.userId },
        '❌ Ошибка отправки Этапа 3 ПА'
      );
      throw error;
    }
  }

  /**
   * Шаг 5: Финальное сообщение сценария ПА (после заземления)
   */
  async handlePanicStep5(callbackQueryId: string): Promise<void> {
    try {
      await this.bot.telegram.answerCbQuery(callbackQueryId);

      // TODO: Здесь будет продолжение сценария, когда ты укажешь что дальше
      const text = `Ты справляешься! Продолжай дышать спокойно и ощущать свое тело ❣️`;

      await sendToUser(this.bot, this.chatId, this.userId, text, {
        parse_mode: 'Markdown',
      });

      botLogger.info({ userId: this.userId }, '✅ Завершен сценарий панической атаки');
    } catch (e) {
      const error = e as Error;
      botLogger.error(
        { error: error.message, stack: error.stack, userId: this.userId },
        '❌ Ошибка отправки финала ПА'
      );
      throw error;
    }
  }

  /**
   * Обработать другие типы тревоги (пока заглушки)
   */
  async handleOtherAnxietyType(callbackQueryId: string, anxietyType: string): Promise<void> {
    try {
      // Сохраняем статистику
      saveHelpStatistics(this.userId, anxietyType);

      await this.bot.telegram.answerCbQuery(callbackQueryId);

      const text = 'Этот раздел пока в разработке. Скоро здесь появятся полезные техники!';

      await sendToUser(this.bot, this.chatId, this.userId, text);

      botLogger.info({ userId: this.userId, anxietyType }, `✅ Обработан выбор "${anxietyType}"`);
    } catch (e) {
      const error = e as Error;
      botLogger.error(
        { error: error.message, stack: error.stack, userId: this.userId, anxietyType },
        '❌ Ошибка обработки другого типа тревоги'
      );
      throw error;
    }
  }
}
