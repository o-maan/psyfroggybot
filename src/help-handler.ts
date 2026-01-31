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

  // ==================== СЦЕНАРИЙ "МЫСЛИ НЕ ОТПУСКАЮТ" ====================

  /**
   * Шаг 1: 5 зеленых предметов
   */
  async handleThoughts(callbackQueryId: string): Promise<void> {
    try {
      // Сохраняем статистику
      saveHelpStatistics(this.userId, 'thoughts');

      await this.bot.telegram.answerCbQuery(callbackQueryId);

      const text = `Прямо сейчас:
Посмотри вокруг 👀 и назови вслух 5 ЗЕЛЕНЫХ 💚 предметов.
Это переключит мозг`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('Готово ✔️', 'help:thoughts_step2')],
      ]);

      await sendToUser(this.bot, this.chatId, this.userId, text, {
        parse_mode: 'Markdown',
        ...keyboard,
      });

      botLogger.info({ userId: this.userId }, '✅ Начат сценарий "Мысли не отпускают" - Шаг 1');
    } catch (e) {
      const error = e as Error;
      botLogger.error(
        { error: error.message, stack: error.stack, userId: this.userId },
        '❌ Ошибка Шаг 1 "Мысли не отпускают"'
      );
      throw error;
    }
  }

  /**
   * Шаг 2: Потрогать 4 предмета
   */
  async handleThoughtsStep2(callbackQueryId: string): Promise<void> {
    try {
      await this.bot.telegram.answerCbQuery(callbackQueryId);

      const text = `Теперь вернемся в настоящий момент:
Потрогай 4 разных предмета, медленно проведи по ним пальцами, отслеживая движение
Обрати внимание на их текстуру, форму, цвет, температуру 🌡
Заметь разницу между ними`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('Готово', 'help:thoughts_step3')],
      ]);

      await sendToUser(this.bot, this.chatId, this.userId, text, {
        parse_mode: 'Markdown',
        ...keyboard,
      });

      botLogger.info({ userId: this.userId }, '✅ Шаг 2 "Мысли не отпускают"');
    } catch (e) {
      const error = e as Error;
      botLogger.error(
        { error: error.message, stack: error.stack, userId: this.userId },
        '❌ Ошибка Шаг 2 "Мысли не отпускают"'
      );
      throw error;
    }
  }

  /**
   * Шаг 3: Счет от 100
   */
  async handleThoughtsStep3(callbackQueryId: string): Promise<void> {
    try {
      await this.bot.telegram.answerCbQuery(callbackQueryId);

      const text = `Посчитай от 100 в обратную сторону через 7: 100, 93, 86, 79...
Продолжи, сделай хотя бы еще 10 раз. Не спеши`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('Готово ✔️', 'help:thoughts_step4')],
      ]);

      await sendToUser(this.bot, this.chatId, this.userId, text, {
        parse_mode: 'Markdown',
        ...keyboard,
      });

      botLogger.info({ userId: this.userId }, '✅ Шаг 3 "Мысли не отпускают"');
    } catch (e) {
      const error = e as Error;
      botLogger.error(
        { error: error.message, stack: error.stack, userId: this.userId },
        '❌ Ошибка Шаг 3 "Мысли не отпускают"'
      );
      throw error;
    }
  }

  /**
   * Шаг 4: Факт или предположение?
   */
  async handleThoughtsStep4(callbackQueryId: string): Promise<void> {
    try {
      await this.bot.telegram.answerCbQuery(callbackQueryId);

      const text = `А теперь вопрос:
То, о чем ты думаешь - это *факт* или *предположение*?`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('Предположение 🤔', 'help:thoughts_assumption')],
        [Markup.button.callback('Факт 📑', 'help:thoughts_fact')],
      ]);

      await sendToUser(this.bot, this.chatId, this.userId, text, {
        parse_mode: 'Markdown',
        ...keyboard,
      });

      botLogger.info({ userId: this.userId }, '✅ Шаг 4 "Мысли не отпускают"');
    } catch (e) {
      const error = e as Error;
      botLogger.error(
        { error: error.message, stack: error.stack, userId: this.userId },
        '❌ Ошибка Шаг 4 "Мысли не отпускают"'
      );
      throw error;
    }
  }

  /**
   * Ветка "Предположение"
   */
  async handleThoughtsAssumption(callbackQueryId: string): Promise<void> {
    try {
      await this.bot.telegram.answerCbQuery(callbackQueryId);

      const text = `Именно! Большинство тревожных мыслей - это не более чем пугающие фантазии в голове, которые чаще всего не имеют ничего общего с реальностью.
Ты не можешь предсказать будущее. Ты не можешь изменить прошлое.
Но ты можешь сделать что-то прямо сейчас.`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('Дальше', 'help:thoughts_step5')],
      ]);

      await sendToUser(this.bot, this.chatId, this.userId, text, {
        parse_mode: 'Markdown',
        ...keyboard,
      });

      botLogger.info({ userId: this.userId }, '✅ Ветка "Предположение"');
    } catch (e) {
      const error = e as Error;
      botLogger.error(
        { error: error.message, stack: error.stack, userId: this.userId },
        '❌ Ошибка ветки "Предположение"'
      );
      throw error;
    }
  }

  /**
   * Ветка "Факт"
   */
  async handleThoughtsFact(callbackQueryId: string): Promise<void> {
    try {
      await this.bot.telegram.answerCbQuery(callbackQueryId);

      const text = `Окей. Даже если это факт - ты можешь контролировать ТОЛЬКО свои действия СЕЙЧАС.
Давай подумаем что ты можешь сделать для себя.`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('Дальше', 'help:thoughts_step5')],
      ]);

      await sendToUser(this.bot, this.chatId, this.userId, text, {
        parse_mode: 'Markdown',
        ...keyboard,
      });

      botLogger.info({ userId: this.userId }, '✅ Ветка "Факт"');
    } catch (e) {
      const error = e as Error;
      botLogger.error(
        { error: error.message, stack: error.stack, userId: this.userId },
        '❌ Ошибка ветки "Факт"'
      );
      throw error;
    }
  }

  /**
   * Шаг 5: Одно маленькое действие
   */
  async handleThoughtsStep5(callbackQueryId: string): Promise<void> {
    try {
      await this.bot.telegram.answerCbQuery(callbackQueryId);

      const text = `Выбери ОДНО маленькое действие, которое сделаешь прямо сейчас:
🔸 Съешь что-то с ярким вкусом
🔸 Маленькими глотками выпей стакан воды
🔸 Выйди на балкон/к окну подышать воздухом
🔸 Поговори с кем-то
🔸 Что-то свое, что захотелось`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('Готово ✔️', 'help:thoughts_better_question')],
      ]);

      await sendToUser(this.bot, this.chatId, this.userId, text, {
        parse_mode: 'Markdown',
        ...keyboard,
      });

      botLogger.info({ userId: this.userId }, '✅ Шаг 5 "Мысли не отпускают"');
    } catch (e) {
      const error = e as Error;
      botLogger.error(
        { error: error.message, stack: error.stack, userId: this.userId },
        '❌ Ошибка Шаг 5 "Мысли не отпускают"'
      );
      throw error;
    }
  }

  /**
   * Вопрос: Стало ли лучше?
   */
  async handleThoughtsBetterQuestion(callbackQueryId: string): Promise<void> {
    try {
      await this.bot.telegram.answerCbQuery(callbackQueryId);

      const text = `Стало лучше?`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('Да, спасибо', 'help:thoughts_better')],
        [Markup.button.callback('Мысли все еще беспокоят 😵‍💫', 'help:thoughts_still_worried')],
      ]);

      await sendToUser(this.bot, this.chatId, this.userId, text, {
        parse_mode: 'Markdown',
        ...keyboard,
      });

      botLogger.info({ userId: this.userId }, '✅ Вопрос "Стало ли лучше?"');
    } catch (e) {
      const error = e as Error;
      botLogger.error(
        { error: error.message, stack: error.stack, userId: this.userId },
        '❌ Ошибка вопроса "Стало ли лучше?"'
      );
      throw error;
    }
  }

  /**
   * Финал: Да, спасибо (стало лучше)
   */
  async handleThoughtsBetter(callbackQueryId: string): Promise<void> {
    try {
      await this.bot.telegram.answerCbQuery(callbackQueryId);

      const text = `Ты молодец! 💚
Ты прервал цикл тревожных мыслей. Мысли могут вернуться, но ты теперь знаешь рецепт:
1. Переключить внимание (цвета, счет)
2. Разделить факты и предположения
3. Сделать действие`;

      await sendToUser(this.bot, this.chatId, this.userId, text, {
        parse_mode: 'Markdown',
      });

      botLogger.info({ userId: this.userId }, '✅ Финал "Да, спасибо" - мысли отпустили');
    } catch (e) {
      const error = e as Error;
      botLogger.error(
        { error: error.message, stack: error.stack, userId: this.userId },
        '❌ Ошибка финала "Да, спасибо"'
      );
      throw error;
    }
  }

  /**
   * Мысли все еще беспокоят
   */
  async handleThoughtsStillWorried(callbackQueryId: string): Promise<void> {
    try {
      await this.bot.telegram.answerCbQuery(callbackQueryId);

      const text = `Понимаю. Иногда мысли бывают очень навязчивыми 🌀
Давай разберемся`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('Давай 🚀', 'help:thoughts_write_down')],
      ]);

      await sendToUser(this.bot, this.chatId, this.userId, text, {
        parse_mode: 'Markdown',
        ...keyboard,
      });

      botLogger.info({ userId: this.userId }, '✅ "Мысли все еще беспокоят"');
    } catch (e) {
      const error = e as Error;
      botLogger.error(
        { error: error.message, stack: error.stack, userId: this.userId },
        '❌ Ошибка "Мысли все еще беспокоят"'
      );
      throw error;
    }
  }

  /**
   * Выписать мысли на бумагу
   */
  async handleThoughtsWriteDown(callbackQueryId: string): Promise<void> {
    try {
      await this.bot.telegram.answerCbQuery(callbackQueryId);

      const text = `Первое - нужно ВЫТАЩИТЬ мысли из головы.
Возьми лист _(лучше работает, когда пишешь от руки)_
И напиши ВСЕ, что крутится в голове. Любыми словами, как идет. Не думай о красоте - просто вывали все! 📝
Когда выпишешь - жми кнопку`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('Готово ✔️', 'help:thoughts_exhale')],
      ]);

      await sendToUser(this.bot, this.chatId, this.userId, text, {
        parse_mode: 'Markdown',
        ...keyboard,
      });

      botLogger.info({ userId: this.userId }, '✅ "Выписать мысли на бумагу"');
    } catch (e) {
      const error = e as Error;
      botLogger.error(
        { error: error.message, stack: error.stack, userId: this.userId },
        '❌ Ошибка "Выписать мысли"'
      );
      throw error;
    }
  }

  /**
   * Выдохни и отпусти
   */
  async handleThoughtsExhale(callbackQueryId: string): Promise<void> {
    try {
      await this.bot.telegram.answerCbQuery(callbackQueryId);

      const text = `Выдохни и отпусти то, что тревожило 😤
Иногда уже на этом этапе можно почувствовать облегчение, тогда можно остановиться`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('Да, достаточно', 'help:thoughts_enough')],
        [Markup.button.callback('Продолжаем 🌪️', 'help:thoughts_continue')],
      ]);

      await sendToUser(this.bot, this.chatId, this.userId, text, {
        parse_mode: 'Markdown',
        ...keyboard,
      });

      botLogger.info({ userId: this.userId }, '✅ "Выдохни и отпусти"');
    } catch (e) {
      const error = e as Error;
      botLogger.error(
        { error: error.message, stack: error.stack, userId: this.userId },
        '❌ Ошибка "Выдохни и отпусти"'
      );
      throw error;
    }
  }

  /**
   * Финал: Да, достаточно
   */
  async handleThoughtsEnough(callbackQueryId: string): Promise<void> {
    try {
      await this.bot.telegram.answerCbQuery(callbackQueryId);

      const text = `Рад, что тебе стало лучше 🤗`;

      await sendToUser(this.bot, this.chatId, this.userId, text, {
        parse_mode: 'Markdown',
      });

      botLogger.info({ userId: this.userId }, '✅ Финал "Да, достаточно"');
    } catch (e) {
      const error = e as Error;
      botLogger.error(
        { error: error.message, stack: error.stack, userId: this.userId },
        '❌ Ошибка финала "Да, достаточно"'
      );
      throw error;
    }
  }

  /**
   * Продолжаем - разделить на категории
   */
  async handleThoughtsContinue(callbackQueryId: string): Promise<void> {
    try {
      await this.bot.telegram.answerCbQuery(callbackQueryId);

      const text = `Теперь все, что ты видишь на листке, нужно разделить на 2 категории, обозначив:
☑️ - то, на что я могу влиять
❌ - не могу влиять (действия/мысли других людей, внешние события и т.д.)
Когда сделаешь, нажимай кнопку`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('Дальше', 'help:thoughts_accept')],
      ]);

      await sendToUser(this.bot, this.chatId, this.userId, text, {
        parse_mode: 'Markdown',
        ...keyboard,
      });

      botLogger.info({ userId: this.userId }, '✅ "Разделить на категории"');
    } catch (e) {
      const error = e as Error;
      botLogger.error(
        { error: error.message, stack: error.stack, userId: this.userId },
        '❌ Ошибка "Разделить на категории"'
      );
      throw error;
    }
  }

  /**
   * Принять то, что не контролируешь
   */
  async handleThoughtsAccept(callbackQueryId: string): Promise<void> {
    try {
      await this.bot.telegram.answerCbQuery(callbackQueryId);

      const text = `То, на что влиять ты НЕ можешь, нужно принять и отпустить.
Мысленно или вслух скажи: "Это не в моей власти, я выбираю направить свою энергию на то, что будет для меня полезным"`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('Дальше', 'help:thoughts_plan')],
      ]);

      await sendToUser(this.bot, this.chatId, this.userId, text, {
        parse_mode: 'Markdown',
        ...keyboard,
      });

      botLogger.info({ userId: this.userId }, '✅ "Принять и отпустить"');
    } catch (e) {
      const error = e as Error;
      botLogger.error(
        { error: error.message, stack: error.stack, userId: this.userId },
        '❌ Ошибка "Принять и отпустить"'
      );
      throw error;
    }
  }

  /**
   * Прописать план
   */
  async handleThoughtsPlan(callbackQueryId: string): Promise<void> {
    try {
      await this.bot.telegram.answerCbQuery(callbackQueryId);

      const text = `А вот с тем, на что ты влиять МОЖЕШЬ мы сейчас поработаем.
Пропиши для себя план, что ты будешь делать по каждой из этих мыслей. Это дает мозгу 🧠 ясность и успокаивает`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('Дальше', 'help:thoughts_small_action')],
      ]);

      await sendToUser(this.bot, this.chatId, this.userId, text, {
        parse_mode: 'Markdown',
        ...keyboard,
      });

      botLogger.info({ userId: this.userId }, '✅ "Прописать план"');
    } catch (e) {
      const error = e as Error;
      botLogger.error(
        { error: error.message, stack: error.stack, userId: this.userId },
        '❌ Ошибка "Прописать план"'
      );
      throw error;
    }
  }

  /**
   * Маленькое действие
   */
  async handleThoughtsSmallAction(callbackQueryId: string): Promise<void> {
    try {
      await this.bot.telegram.answerCbQuery(callbackQueryId);

      const text = `Какое самое маленькое действие я могу сделать прямо сейчас? _(даже если это просто найти что-то в поисковике или отправить сообщение)_
Сделай это 🔥`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('Готово ✔️', 'help:thoughts_final')],
      ]);

      await sendToUser(this.bot, this.chatId, this.userId, text, {
        parse_mode: 'Markdown',
        ...keyboard,
      });

      botLogger.info({ userId: this.userId }, '✅ "Маленькое действие"');
    } catch (e) {
      const error = e as Error;
      botLogger.error(
        { error: error.message, stack: error.stack, userId: this.userId },
        '❌ Ошибка "Маленькое действие"'
      );
      throw error;
    }
  }

  /**
   * Финальное сообщение
   */
  async handleThoughtsFinal(callbackQueryId: string): Promise<void> {
    try {
      await this.bot.telegram.answerCbQuery(callbackQueryId);

      const text = `Ура! 🎉 Теперь у тебя есть план действий! Ты со всем справишься

В завершении можешь сделать любое физическое упражнение _(10 приседаний, прогулка, прыжки на месте)_
Важно: обращай внимание на действия и на ощущения.
Это поможет перевести внимание и завершить процесс`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('Спасибо', 'help:thoughts_thanks')],
      ]);

      await sendToUser(this.bot, this.chatId, this.userId, text, {
        parse_mode: 'Markdown',
        ...keyboard,
      });

      botLogger.info({ userId: this.userId }, '✅ "Финальное сообщение"');
    } catch (e) {
      const error = e as Error;
      botLogger.error(
        { error: error.message, stack: error.stack, userId: this.userId },
        '❌ Ошибка "Финальное сообщение"'
      );
      throw error;
    }
  }

  /**
   * Спасибо (финал)
   */
  async handleThoughtsThanks(callbackQueryId: string): Promise<void> {
    try {
      await this.bot.telegram.answerCbQuery(callbackQueryId);

      const text = `Рад, что мы смогли разобраться. Надеюсь, тебе стало лучше 🤗`;

      await sendToUser(this.bot, this.chatId, this.userId, text, {
        parse_mode: 'Markdown',
      });

      botLogger.info({ userId: this.userId }, '✅ Финал "Спасибо"');
    } catch (e) {
      const error = e as Error;
      botLogger.error(
        { error: error.message, stack: error.stack, userId: this.userId },
        '❌ Ошибка финала "Спасибо"'
      );
      throw error;
    }
  }

  // ==================== КОНЕЦ СЦЕНАРИЯ "МЫСЛИ НЕ ОТПУСКАЮТ" ====================

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
