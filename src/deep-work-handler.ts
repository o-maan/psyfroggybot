import { Telegraf } from 'telegraf';
import { readFileSync } from 'fs';
import path from 'path';
import { generateMessage } from './llm';
import { botLogger } from './logger';
import { 
  updateInteractivePostState, 
  getInteractivePost,
  saveMessage,
  updateTaskStatus
} from './db';

// Функция для удаления тегов <think>
function removeThinkTags(text: string): string {
  const lastThinkClose = text.lastIndexOf('</think>');
  if (lastThinkClose !== -1 && text.trim().startsWith('<think>')) {
    return text.substring(lastThinkClose + 8).trim();
  }
  return text;
}

// Примеры для разбора по схеме
const SCHEMA_EXAMPLES = [
  {
    trigger: 'Получил отказ после собеседования',
    thoughts: '"Я никогда не найду работу"',
    emotions: 'Разочарование, безнадежность, злость на себя',
    behavior: 'Перестал откликаться на вакансии, лег и смотрю сериалы',
    correction: 'Это опыт, я не могу подходить всем. Попросить фидбек, улучшить резюме, продолжить поиски'
  },
  {
    trigger: 'Партнер не помыл посуду, хотя обещал',
    thoughts: '"Ему плевать на меня и на все, что я говорю"',
    emotions: 'Обида, злость, разочарование. Ком в горле',
    behavior: 'Хлопнула дверью, ушла в другую комнату, игнорирую',
    correction: 'Спокойно поговорить, объяснить свои чувства. Возможно, он просто забыл'
  },
  {
    trigger: 'Коллега не ответил на важное сообщение',
    thoughts: '"Он игнорирует меня специально. Я ему не важен"',
    emotions: 'Обида, злость, тревога. Сжалось в груди',
    behavior: 'Написал резкое сообщение с претензиями',
    correction: 'Подождать ответа, уточнить спокойно. Возможно, он просто занят'
  }
];

// Примеры для фильтров восприятия
const PERCEPT_FILTERS_EXAMPLES = [
  {
    thoughts: 'Сказал глупость на совещании - все подумают, что я некомпетентный, меня уволят',
    distortions: 'Чтение мыслей + катастрофизация',
    rational: 'Я не могу знать, что думают другие. Вероятно, они даже не заметили. А если заметили - один комментарий не отменяет мои знания и опыт'
  },
  {
    thoughts: 'Он не ответил на сообщение - наверное, я его раздражаю',
    distortions: 'Персонализация + чтение мыслей', 
    rational: 'У него может быть множество причин не отвечать. Они не обязательно связаны со мной. Лучше дождаться ответа, чем строить догадки'
  },
  {
    thoughts: 'Я забыл купить нужные продукты - я никчемный, ничего не могу сделать нормально',
    distortions: 'Преувеличение + обобщение',
    rational: 'Это мелочь и не трагедия. Все забывают. Это не делает меня никчемным. Я со многим справляюсь каждый день'
  }
];

export class DeepWorkHandler {
  private bot: Telegraf;
  private exampleCounters: Map<string, number> = new Map();
  private schemaExampleCounters: Map<string, number> = new Map();
  private chatId: number; // ID чата откуда пришло сообщение (как replyToChatId в упрощенном сценарии)

  constructor(bot: Telegraf, chatId: number) {
    this.bot = bot;
    // ВАЖНО: используем переданный chatId (это replyToChatId из handleInteractiveUserResponse)
    this.chatId = chatId;
  }

  // Получить текст кнопки в зависимости от количества нажатий
  private getExampleButtonText(channelMessageId: number): string {
    const key = `examples_${channelMessageId}`;
    const count = this.exampleCounters.get(key) || 0;
    // Если уже показаны все 3 примера - возвращаем null (кнопка не будет показана)
    if (count >= 3) {
      return '';
    }
    return count > 0 ? 'Показать еще пример' : 'Показать пример';
  }
  
  // Получить текст кнопки для примеров схемы
  private getSchemaExampleButtonText(channelMessageId: number): string {
    const key = `schema_examples_${channelMessageId}`;
    const count = this.schemaExampleCounters.get(key) || 0;
    // После 3 примеров кнопка не показывается
    if (count >= 3) {
      return '';
    }
    return count > 0 ? 'Еще пример' : 'Пример';
  }
  
  // Универсальный метод отправки сообщений (как в упрощенном сценарии)
  private async sendMessage(
    text: string, 
    replyToMessageId?: number,
    options: {
      parse_mode?: string;
      reply_markup?: any;
    } = {}
  ) {
    const sendOptions: any = {
      parse_mode: options.parse_mode || 'HTML',
      ...options
    };
    
    // ВСЕГДА добавляем reply_parameters если есть messageId
    if (replyToMessageId) {
      sendOptions.reply_parameters = {
        message_id: replyToMessageId
      };
    }
    
    // Отправляем в тот же чат откуда пришло сообщение (как replyToChatId в упрощенном)
    return await this.bot.telegram.sendMessage(this.chatId, text, sendOptions);
  }
  

  // Анализ ответа пользователя и выбор техники
  async analyzeUserResponse(channelMessageId: number, userText: string, userId: number, replyToMessageId?: number): Promise<void> {
    let waitingMessage: any;
    
    try {
      botLogger.info({
        channelMessageId,
        userId,
        replyToMessageId,
        hasReplyId: !!replyToMessageId
      }, 'analyzeUserResponse вызван с параметрами');
      
      // Проверка секретных слов для админов
      const adminIds = [
        Number(process.env.ADMIN_CHAT_ID),
        Number(process.env.MAIN_USER_ID || process.env.REMINDER_USER_ID),
        Number(process.env.TEST_USER_ID)
      ].filter(id => !isNaN(id));
      
      const isAdmin = adminIds.includes(userId);
      const textLower = userText.trim().toLowerCase();
      
      // Если админ использует секретное слово
      if (isAdmin) {
        let forcedTechnique: string | null = null;
        
        if (textLower.startsWith('схема')) {
          forcedTechnique = 'schema';
          botLogger.info({ userId, channelMessageId }, '🔑 Админ использовал секретное слово "схема"');
        } else if (textLower.startsWith('фильтры')) {
          forcedTechnique = 'percept_filters';
          botLogger.info({ userId, channelMessageId }, '🔑 Админ использовал секретное слово "фильтры"');
        }
        
        if (forcedTechnique) {
          // Если выбрана техника "разбор по схеме" - генерируем слова поддержки заранее
          if (forcedTechnique === 'schema') {
            await this.generateAndSaveSupportWords(channelMessageId, userText, userId);
          }
          // Сразу переходим к выбранной технике
          await this.startTechnique(channelMessageId, forcedTechnique, userId, replyToMessageId);
          return;
        }
      }
      
      // Отправляем сообщение о подборе техники
      waitingMessage = await this.sendMessage(
        'Подбираю технику.. 🧐',
        replyToMessageId
      );
      
      // Загружаем промпт для анализа
      const analyzePrompt = readFileSync('assets/prompts/analyze_situations.md', 'utf-8');
      const fullPrompt = analyzePrompt + '\n' + userText;
      
      // Запрашиваем анализ у LLM
      const response = await generateMessage(fullPrompt);
      
      if (response === 'HF_JSON_ERROR') {
        throw new Error('Ошибка генерации LLM');
      }

      const cleanedResponse = removeThinkTags(response);
      const analysis = JSON.parse(cleanedResponse.replace(/```json|```/gi, '').trim());

      botLogger.info({
        channelMessageId,
        situationsCount: analysis.situations_count,
        technique: analysis.recommended_technique.type
      }, 'Анализ ситуаций завершен');
      
      // Удаляем сообщение о подборе техники
      try {
        await this.bot.telegram.deleteMessage(this.chatId, waitingMessage.message_id);
      } catch (deleteError) {
        botLogger.debug({ error: deleteError }, 'Не удалось удалить сообщение о подборе техники');
      }

      // Если ситуаций несколько - спрашиваем какую разберем
      if (analysis.situations_count > 1) {
        // Сохраняем рекомендованную технику для использования после выбора ситуации
        await this.saveRecommendedTechnique(channelMessageId, analysis.recommended_technique.type);
        await this.askWhichSituation(channelMessageId, analysis.situations, userId, replyToMessageId);
      } else {
        // Если выбрана техника "разбор по схеме" - генерируем слова поддержки заранее
        if (analysis.recommended_technique.type === 'schema' || analysis.recommended_technique.type === 'abc') {
          await this.generateAndSaveSupportWords(channelMessageId, userText, userId);
        }
        // Сразу переходим к технике
        await this.startTechnique(channelMessageId, analysis.recommended_technique.type, userId, replyToMessageId);
      }
      
    } catch (error) {
      botLogger.error({ error, channelMessageId }, 'Ошибка анализа ответа пользователя');
      
      // Пытаемся удалить сообщение о подборе техники, если оно было создано
      if (waitingMessage) {
        try {
          await this.bot.telegram.deleteMessage(this.chatId, waitingMessage.message_id);
        } catch (deleteError) {
          botLogger.debug({ error: deleteError }, 'Не удалось удалить сообщение о подборе техники при ошибке');
        }
      }
      
      // Fallback - используем разбор по схеме (более простая техника, не требует LLM для выбора)
      try {
        botLogger.info({ channelMessageId }, 'LLM недоступен, используем разбор по схеме как fallback');
        
        // Генерируем слова поддержки для схемы
        await this.generateAndSaveSupportWords(channelMessageId, userText, userId);
        
        // Запускаем разбор по схеме
        await this.startTechnique(channelMessageId, 'schema', userId, replyToMessageId);
      } catch (fallbackError) {
        botLogger.error({ 
          error: fallbackError, 
          channelMessageId,
          originalError: error 
        }, 'Ошибка при попытке fallback на разбор по схеме');
        // Отправляем простое fallback сообщение
        try {
          await this.sendMessage(
            'Извини, произошла техническая ошибка. Попробуй еще раз позже или продолжи в упрощенном режиме.',
            replyToMessageId
          );
        } catch (finalError) {
          botLogger.error({
            error: finalError,
            channelMessageId,
            chatId: this.chatId,
            replyToMessageId
          }, 'Критическая ошибка - не можем отправить даже fallback сообщение');
        }
      }
    }
  }

  // Спрашиваем какую ситуацию разберем
  private async askWhichSituation(channelMessageId: number, situations: any[], userId: number, replyToMessageId?: number) {
    const post = getInteractivePost(channelMessageId);
    if (!post) return;

    const buttons = situations.map((sit, index) => [{
      text: `${index + 1}. ${sit.brief}`,
      callback_data: `deep_situation_${channelMessageId}_${index}`
    }]);

    const keyboard = { inline_keyboard: buttons };
    
    const message = await this.sendMessage(
      'Какую ситуацию разберем подробнее?',
      replyToMessageId,
      {
        reply_markup: keyboard,
        parse_mode: 'HTML'
      }
    );

    // Сохраняем состояние
    updateInteractivePostState(channelMessageId, 'deep_waiting_situation_choice', {
      bot_schema_message_id: message.message_id // Используем существующее поле для ID сообщения
    });
    
    // Сохраняем ситуации отдельно в сессии
    // TODO: сохранить situations в отдельной структуре
  }

  // Начинаем технику
  async startTechnique(channelMessageId: number, techniqueType: string, userId: number, replyToMessageId?: number) {
    if (techniqueType === 'percept_filters') {
      await this.startPerceptFilters(channelMessageId, userId, replyToMessageId);
    } else if (techniqueType === 'schema' || techniqueType === 'abc') {
      await this.startSchemaAnalysis(channelMessageId, userId, replyToMessageId);
    }
  }

  // Начинаем работу с фильтрами восприятия
  private async startPerceptFilters(channelMessageId: number, userId: number, replyToMessageId?: number) {
    try {
      botLogger.info({
        channelMessageId,
        userId,
        replyToMessageId,
        hasReplyId: !!replyToMessageId,
        chatId: this.chatId,
        chatIdType: typeof this.chatId
      }, 'Начинаем отправку фильтров восприятия');
      
      // Отправляем объяснение С картинкой
      const text = 'Давай разберем через фильтры восприятия';
      
      const reply_markup = {
        inline_keyboard: [[
          { text: '🚀 Погнали', callback_data: `deep_filters_start_${channelMessageId}` }
        ]]
      };
      
      botLogger.debug({
        channelMessageId,
        chatId: this.chatId,
        replyToMessageId,
        text
      }, 'Отправляем сообщение с фильтрами восприятия');
      
      // Загружаем картинку
      const imagePath = path.join(process.cwd(), 'assets', 'images', 'percept-filters-info.png');
      const imageBuffer = readFileSync(imagePath);
      
      // Отправляем картинку с текстом
      const sendOptions: any = {
        caption: text,
        parse_mode: 'HTML',
        reply_markup
      };
      
      // Используем старый формат reply_to_message_id (как в первом задании)
      if (replyToMessageId) {
        sendOptions.reply_to_message_id = replyToMessageId;
      }
      
      const message = await this.bot.telegram.sendPhoto(this.chatId, { source: imageBuffer }, sendOptions);

      updateInteractivePostState(channelMessageId, 'deep_waiting_filters_start');
    } catch (error) {
      botLogger.error({ error, channelMessageId }, 'Ошибка начала фильтров восприятия');
      
      // Фолбэк - отправляем текст без картинки
      try {
        const fallbackText = 'Давай разберем через фильтры восприятия\n\n' +
                           'Фильтры восприятия - это когнитивные искажения, которые влияют на наши мысли и эмоции';
        
        const fallbackOptions: any = {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[
              { text: '🚀 Погнали', callback_data: `deep_filters_start_${channelMessageId}` }
            ]]
          }
        };
        
        if (replyToMessageId) {
          fallbackOptions.reply_parameters = {
            message_id: replyToMessageId
          };
        }
        
        await this.bot.telegram.sendMessage(this.chatId, fallbackText, fallbackOptions);
        updateInteractivePostState(channelMessageId, 'deep_waiting_filters_start');
        
      } catch (fallbackError) {
        botLogger.error({ fallbackError, channelMessageId }, 'Ошибка отправки fallback сообщения');
        throw fallbackError; // Пробрасываем дальше для общего обработчика
      }
    }
  }

  // Обработчик кнопки "Погнали" для фильтров
  async handleFiltersStart(channelMessageId: number, userId: number, replyToMessageId?: number) {
    const buttonText = this.getExampleButtonText(channelMessageId);
    const messageOptions: any = {};
    
    // Добавляем кнопку только если есть доступные примеры
    if (buttonText) {
      messageOptions.reply_markup = {
        inline_keyboard: [[
          { text: buttonText, callback_data: `deep_filters_example_${channelMessageId}` }
        ]]
      };
    }
    
    const message = await this.sendMessage(
      'Какие <b>мысли</b> возникли в выбранном событии?',
      replyToMessageId,
      messageOptions
    );

    updateInteractivePostState(channelMessageId, 'deep_waiting_thoughts', {
      bot_task2_message_id: message.message_id // Используем существующее поле
    });

    // НЕ сбрасываем счетчик - он должен сохраняться между этапами
  }

  // Показ примера для мыслей
  async showThoughtsExample(channelMessageId: number, userId: number, replyToMessageId?: number) {
    // Используем общий ключ для всех типов примеров
    const key = `examples_${channelMessageId}`;
    let count = this.exampleCounters.get(key) || 0;
    
    // Если счетчик пустой, пробуем загрузить из БД
    if (count === 0) {
      const post = getInteractivePost(channelMessageId);
      if (post?.message_data?.filters_example_count !== undefined) {
        count = post.message_data.filters_example_count;
        this.exampleCounters.set(key, count);
      }
    }
    
    botLogger.debug({ 
      channelMessageId, 
      count, 
      key,
      hasCounter: this.exampleCounters.has(key),
      handlerId: this.chatId
    }, 'showThoughtsExample: текущий счетчик');

    // Если уже показали финальное сообщение - ничего не делаем
    if (count >= 5) {
      return; // Молча выходим, не показываем никаких сообщений
    }

    if (count >= 3) {
      const sendOptions: any = {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: 'Показать фильтры', callback_data: `show_filters_${channelMessageId}` }
          ]]
        }
      };
      
      if (replyToMessageId) {
        sendOptions.reply_parameters = {
          message_id: replyToMessageId
        };
      }
      
      // 4-е нажатие - показываем первое финальное сообщение
      if (count === 3) {
        await this.bot.telegram.sendMessage(this.chatId,
          'Больше примеров можешь посмотреть в карточках <b>Фильтры восприятия</b>',
          sendOptions
        );
        
        // Увеличиваем счетчик для перехода к следующему сообщению
        const newCount = count + 1;
        this.exampleCounters.set(key, newCount);
        await this.saveFiltersExampleCount(channelMessageId, newCount);
      } else if (count === 4) {
        // 5-е нажатие - показываем финальное сообщение и устанавливаем счетчик в 5
        await this.bot.telegram.sendMessage(this.chatId,
          'Примеры смотри выше или открывай фильтры восприятия',
          sendOptions
        );
        // Устанавливаем счетчик в 5, чтобы кнопки стали неактивными
        this.exampleCounters.set(key, 5);
        await this.saveFiltersExampleCount(channelMessageId, 5);
      }
    } else {
      // Показываем пример
      const example = PERCEPT_FILTERS_EXAMPLES[count];
      const text = `<b>🧠 Мысли:</b> ${example.thoughts}\n\n<b>😵‍💫 Искажения:</b> ${example.distortions}\n\n<b>💡 Рациональная реакция:</b> ${example.rational}`;
      
      // Определяем какую кнопку показывать под примером
      const nextCount = count + 1;
      let keyboard;
      
      if (nextCount >= 3) {
        // Это последний пример - показываем кнопку "Показать фильтры"
        keyboard = {
          inline_keyboard: [[
            { text: 'Показать фильтры', callback_data: `show_filters_${channelMessageId}` }
          ]]
        };
      } else {
        // Есть еще примеры - показываем кнопку "Еще пример"
        // Используем тот же callback_data для единого счетчика
        keyboard = {
          inline_keyboard: [[
            { text: 'Еще пример', callback_data: `deep_filters_example_${channelMessageId}` }
          ]]
        };
      }
      
      await this.sendMessage(text, replyToMessageId, {
        reply_markup: keyboard
      });
      
      const newCount = count + 1;
      this.exampleCounters.set(key, newCount);
      await this.saveFiltersExampleCount(channelMessageId, newCount);
    }
  }
  
  // Показ примера для искажений - использует общий счетчик
  async showDistortionsExample(channelMessageId: number, userId: number, replyToMessageId?: number) {
    await this.showThoughtsExample(channelMessageId, userId, replyToMessageId);
  }
  
  // Показ примера для рациональной реакции - использует общий счетчик
  async showRationalExample(channelMessageId: number, userId: number, replyToMessageId?: number) {
    await this.showThoughtsExample(channelMessageId, userId, replyToMessageId);
  }

  // Обработка ответа на мысли
  async handleThoughtsResponse(channelMessageId: number, userText: string, userId: number, replyToMessageId?: number) {
    const buttonText = this.getExampleButtonText(channelMessageId);
    const keyboard = [];
    
    // Добавляем кнопку примера только если есть доступные примеры
    if (buttonText) {
      keyboard.push([{ text: buttonText, callback_data: `deep_filters_example_${channelMessageId}` }]);
    }
    // Кнопка "Показать фильтры" добавляется всегда
    keyboard.push([{ text: 'Показать фильтры', callback_data: `show_filters_${channelMessageId}` }]);
    
    // Переходим к искажениям
    const message = await this.sendMessage(
      'Какие <b>искажения</b> ты здесь видишь?',
      replyToMessageId,
      {
        reply_markup: {
          inline_keyboard: keyboard
        }
      }
    );

    updateInteractivePostState(channelMessageId, 'deep_waiting_distortions', {
      user_task2_message_id: message.message_id // Используем существующее поле для ID сообщения бота
    });

    // Счетчик примеров уже обновлен в showThoughtsExample
  }

  // Обработка ответа на искажения
  async handleDistortionsResponse(channelMessageId: number, userText: string, userId: number, replyToMessageId?: number) {
    const buttonText = this.getExampleButtonText(channelMessageId);
    const keyboard = [];
    
    // Добавляем кнопку примера только если есть доступные примеры
    if (buttonText) {
      keyboard.push([{ text: buttonText, callback_data: `deep_filters_example_${channelMessageId}` }]);
    }
    // Кнопка "Показать фильтры" добавляется всегда
    keyboard.push([{ text: 'Показать фильтры', callback_data: `show_filters_${channelMessageId}` }]);
    
    // Переходим к рациональной реакции
    const message = await this.sendMessage(
      'А теперь постарайся написать <b>рациональную реакцию</b>',
      replyToMessageId,
      {
        reply_markup: {
          inline_keyboard: keyboard
        }
      }
    );

    updateInteractivePostState(channelMessageId, 'deep_waiting_rational', {
      bot_task3_message_id: message.message_id // Используем существующее поле
    });
  }

  // Показ карточек фильтров
  async showFiltersCards(channelMessageId: number, userId: number, replyToMessageId?: number) {
    // В упрощенном варианте просто отправляем текстовое описание
    await this.sendMessage(
      '<b>Основные когнитивные искажения:</b>\n\n' +
      '🔮 <b>Чтение мыслей</b> - предполагаем, что знаем, о чем думают другие\n\n' +
      '💣 <b>Катастрофизация</b> - ожидаем худшего исхода событий\n\n' +
      '🎯 <b>Персонализация</b> - берем на себя вину за то, что от нас не зависит\n\n' +
      '♾ <b>Обобщение</b> - используем слова "всегда", "никогда", "все", "никто"\n\n' +
      '📈 <b>Преувеличение/преуменьшение</b> - искажаем значимость событий\n\n' +
      '⚫⚪ <b>Черно-белое мышление</b> - видим только крайности без полутонов',
      replyToMessageId
    );
  }

  // Продолжение с плюшками после фильтров
  async continueToPluskas(channelMessageId: number, userId: number, replyToMessageId?: number) {
    try {
      // Отправляем задание про плюшки
      const message = await this.sendMessage(
        '<i>Важно замечать каждую мелкую радость 😍</i>\n\n' +
        '2. <b>Что хорошего было сегодня?</b>\n' +
        'Постарайся вспомнить как можно больше приятностей <i>(чем больше, тем лучше - минимум 3)</i>',
        replyToMessageId
      );

      // Обновляем состояние
      updateInteractivePostState(channelMessageId, 'deep_waiting_positive', {
        bot_task2_message_id: message.message_id
      });
      
      updateTaskStatus(channelMessageId, 2, false); // Отмечаем что задание 2 начато

    } catch (error) {
      botLogger.error({ error, channelMessageId }, 'Ошибка перехода к плюшкам');
      throw error;
    }
  }

  // Начинаем разбор по схеме
  private async startSchemaAnalysis(channelMessageId: number, userId: number, replyToMessageId?: number) {
    try {
      // Генерируем слова поддержки заранее для схемы
      const post = getInteractivePost(channelMessageId);
      if (post && !post.message_data?.schema_support?.text) {
        // Используем последнее сообщение пользователя для контекста
        const { getLastUserMessage } = await import('./db');
        const lastUserMessage = getLastUserMessage(userId);
        const userContext = lastUserMessage?.message_text || 'переживания и эмоции';
        await this.generateAndSaveSupportWords(channelMessageId, userContext, userId);
      }
      
      const text = 'Давай разложим все на свои места 📂';
      
      const keyboard = {
        inline_keyboard: [[
          { text: '🚀 Вперед', callback_data: `schema_start_${channelMessageId}` }
        ]]
      };
      
      const message = await this.sendMessage(text, replyToMessageId, {
        reply_markup: keyboard
      });

      updateInteractivePostState(channelMessageId, 'schema_waiting_start');
    } catch (error) {
      botLogger.error({ error, channelMessageId }, 'Ошибка начала разбора по схеме');
      throw error;
    }
  }

  // Обработчик кнопки "Вперед" для разбора по схеме
  async handleSchemaStart(channelMessageId: number, userId: number, replyToMessageId?: number) {
    const buttonText = this.getSchemaExampleButtonText(channelMessageId);
    const messageOptions: any = {};
    
    // Добавляем кнопку только если есть доступные примеры
    if (buttonText) {
      messageOptions.reply_markup = {
        inline_keyboard: [[
          { text: buttonText, callback_data: `schema_example_${channelMessageId}` }
        ]]
      };
    }
    
    const message = await this.sendMessage(
      '<b>Что в данном случае было 💣 триггером?</b>\n<i>Что именно из всей ситуации спровоцировало твою реакцию?</i>',
      replyToMessageId,
      messageOptions
    );

    updateInteractivePostState(channelMessageId, 'schema_waiting_trigger');
  }

  // Обработка ответа на триггер
  async handleTriggerResponse(channelMessageId: number, userText: string, userId: number, replyToMessageId?: number) {
    const buttonText = this.getSchemaExampleButtonText(channelMessageId);
    const messageOptions: any = {};
    
    if (buttonText) {
      messageOptions.reply_markup = {
        inline_keyboard: [[
          { text: buttonText, callback_data: `schema_example_${channelMessageId}` }
        ]]
      };
    }
    
    const message = await this.sendMessage(
      '<b>Какие мысли 💭 возникли?</b>\n<i>Что подумал о себе/человеке/ситуации? Какие выводы ты сделал?</i>',
      replyToMessageId,
      messageOptions
    );

    updateInteractivePostState(channelMessageId, 'schema_waiting_thoughts');
  }

  // Обработка ответа на мысли
  async handleSchemaThoughtsResponse(channelMessageId: number, userText: string, userId: number, replyToMessageId?: number) {
    const buttonText = this.getSchemaExampleButtonText(channelMessageId);
    const keyboard = [
      [{ text: 'Помоги с эмоциями', callback_data: `emotions_table_${channelMessageId}` }]
    ];
    
    if (buttonText) {
      keyboard.push([{ text: buttonText, callback_data: `schema_example_${channelMessageId}` }]);
    }
    
    const message = await this.sendMessage(
      '<b>Какие эмоции 🥺 ты испытал?</b>\n<i>Что почувствовал? Как отреагировало твое тело?</i>',
      replyToMessageId,
      {
        reply_markup: { inline_keyboard: keyboard }
      }
    );

    updateInteractivePostState(channelMessageId, 'schema_waiting_emotions');
  }

  // Сохранение рекомендованной техники в БД
  private async saveRecommendedTechnique(channelMessageId: number, techniqueType: string) {
    try {
      const post = getInteractivePost(channelMessageId);
      if (post) {
        const updatedMessageData = {
          ...post.message_data,
          recommended_technique: techniqueType
        };
        
        const { db } = await import('./db');
        const update = db.query(`
          UPDATE interactive_posts
          SET message_data = ?
          WHERE channel_message_id = ?
        `);
        update.run(JSON.stringify(updatedMessageData), channelMessageId);
        
        botLogger.info({ channelMessageId, techniqueType }, 'Рекомендованная техника сохранена');
      }
    } catch (error) {
      botLogger.error({ error, channelMessageId }, 'Ошибка сохранения рекомендованной техники');
    }
  }

  // Генерация и сохранение слов поддержки заранее
  async generateAndSaveSupportWords(channelMessageId: number, userSituation: string, userId: number) {
    try {
      const supportPrompt = `Ты психолог. Человек рассказал про сложную ситуацию и сейчас будет описывать свои эмоции. Напиши краткие слова поддержки (до 70 символов) с одним эмодзи в конце. 

ВАЖНО: НЕ указывай количество символов в скобках или любую другую техническую информацию! Просто напиши фразу поддержки. Будь человечным! Пиши как будто мы ведем теплую беседу.

Примеры хороших фраз поддержки:
- Спасибо, что поделился 💚
- Понимаю тебя 🤗
- Обнимаю, я рядом 🫂
- Спасибо за доверие 🌿
- Это действительно непросто 💛
- Твои чувства важны 💙
- Слышу тебя 🤍
- Ты не один в этом 🌱
- Благодарю за откровенность 🌸
- Это требует смелости 💪
- Принимаю твои чувства 🌊
- Ты молодец, что проговариваешь 🌟
- Понимаю, как тебе сейчас 🤲
- Эти эмоции имеют право быть 🌈
- Ценю твою искренность 💝
- Ты справляешься 🌺
- Это нормально так чувствовать 🕊️
- Горжусь твоей открытостью ✨

Напиши одну короткую подобную фразу поддержки с эмодзи, не повторяя примеры дословно. Будь искренним и теплым. ТОЛЬКО фраза, без кавычек, без скобок, без технической информации.`;
      
      let supportText = 'Понимаю тебя 💚'; // Дефолтный текст
      try {
        const generatedSupport = await generateMessage(supportPrompt);
        if (generatedSupport !== 'HF_JSON_ERROR') {
          let cleanedSupport = removeThinkTags(generatedSupport).trim();
          // Удаляем любые технические пометки в скобках
          cleanedSupport = cleanedSupport.replace(/\s*\([^)]*символ[^)]*\)/gi, ''); // удаляем все скобки со словом "символ"
          cleanedSupport = cleanedSupport.replace(/\s*\(\d+[^)]*\)/g, ''); // удаляем любые скобки с числами
          cleanedSupport = cleanedSupport.replace(/\s*\([^)]*\)/g, ''); // удаляем вообще любые скобки
          // Удаляем кавычки в начале и конце, если есть
          cleanedSupport = cleanedSupport.replace(/^["']|["']$/g, '').trim();
          
          if (cleanedSupport.length <= 80) {
            supportText = cleanedSupport;
          }
        }
      } catch (error) {
        botLogger.error({ error }, 'Ошибка генерации слов поддержки');
      }

      // Получаем текущий пост
      const post = getInteractivePost(channelMessageId);
      if (post) {
        // Обновляем message_data с словами поддержки
        const updatedMessageData = {
          ...post.message_data,
          schema_support: {
            text: supportText,
            generated_at: new Date().toISOString()
          }
        };
        
        // Обновляем в БД
        const { db } = await import('./db');
        const update = db.query(`
          UPDATE interactive_posts
          SET message_data = ?
          WHERE channel_message_id = ?
        `);
        update.run(JSON.stringify(updatedMessageData), channelMessageId);
        
        botLogger.info({ channelMessageId, supportText }, 'Слова поддержки сгенерированы и сохранены');
      }
    } catch (error) {
      botLogger.error({ error, channelMessageId }, 'Ошибка сохранения слов поддержки');
    }
  }

  // Обработка ответа на эмоции с использованием предварительно сгенерированных слов поддержки
  async handleSchemaEmotionsResponse(channelMessageId: number, userText: string, userId: number, replyToMessageId?: number) {
    try {
      // Получаем предварительно сгенерированные слова поддержки
      const post = getInteractivePost(channelMessageId);
      let supportText = '<i>Понимаю тебя 💚</i>'; // Дефолтный текст
      
      if (post?.message_data?.schema_support?.text) {
        supportText = `<i>${post.message_data.schema_support.text}</i>`;
      }

      const buttonText = this.getSchemaExampleButtonText(channelMessageId);
      const messageOptions: any = {};
      
      if (buttonText) {
        messageOptions.reply_markup = {
          inline_keyboard: [[
            { text: buttonText, callback_data: `schema_example_${channelMessageId}` }
          ]]
        };
      }
      
      const message = await this.sendMessage(
        supportText + '\n\n<b>Какое поведение 💃 или импульс к действию спровоцировала ситуация?</b>\n<i>Что ты сделал? Как отреагировал? Или что хотелось сделать?</i>',
        replyToMessageId,
        messageOptions
      );

      updateInteractivePostState(channelMessageId, 'schema_waiting_behavior');
    } catch (error) {
      botLogger.error({ error, channelMessageId }, 'Ошибка обработки эмоций');
      throw error;
    }
  }

  // Обработка ответа на поведение
  async handleSchemaBehaviorResponse(channelMessageId: number, userText: string, userId: number, replyToMessageId?: number) {
    const buttonText = this.getSchemaExampleButtonText(channelMessageId);
    const messageOptions: any = {};
    
    if (buttonText) {
      messageOptions.reply_markup = {
        inline_keyboard: [[
          { text: buttonText, callback_data: `schema_example_${channelMessageId}` }
        ]]
      };
    }
    
    const message = await this.sendMessage(
      '<b>А теперь подумай, как можно скорректировать 🛠 твою реакцию?</b>\n<i>Как более рационально поступить/отреагировать/что сделать?</i>',
      replyToMessageId,
      messageOptions
    );

    updateInteractivePostState(channelMessageId, 'schema_waiting_correction');
  }

  // Обработка ответа на коррекцию поведения
  async handleSchemaCorrectionResponse(channelMessageId: number, userText: string, userId: number, replyToMessageId?: number) {
    const keyboard = {
      inline_keyboard: [[
        { text: 'Го 🔥', callback_data: `schema_continue_${channelMessageId}` }
      ]]
    };
    
    const message = await this.sendMessage(
      '<i>Ты проделал огромную работу! 🎉</i>\n\n' +
      'Осталось всего пару шагов 👣\n' +
      '<i>P.S. Не переживай, самая сложная часть позади\n' +
      'Перейдем к более приятной 😉</i>',
      replyToMessageId,
      {
        reply_markup: keyboard
      }
    );

    updateInteractivePostState(channelMessageId, 'schema_waiting_continue');
  }

  // Показ примера для разбора по схеме
  async showSchemaExample(channelMessageId: number, userId: number, replyToMessageId?: number) {
    const key = `schema_examples_${channelMessageId}`;
    let count = this.schemaExampleCounters.get(key) || 0;
    
    // Если счетчик пустой, пробуем загрузить из БД
    if (count === 0) {
      const post = getInteractivePost(channelMessageId);
      if (post?.message_data?.schema_example_count !== undefined) {
        count = post.message_data.schema_example_count;
        this.schemaExampleCounters.set(key, count);
      }
    }
    
    botLogger.debug({ 
      channelMessageId, 
      count, 
      key,
      hasCounter: this.schemaExampleCounters.has(key),
      handlerId: this.chatId
    }, 'showSchemaExample: текущий счетчик');
    
    // Если уже показали все примеры
    if (count >= 5) {
      return; // Молча выходим
    }
    
    if (count === 3) {
      // Первое сообщение после 3 примеров
      await this.sendMessage(
        'Больше примеров нет - уверен, ты справишься!',
        replyToMessageId
      );
      const newCount = count + 1;
      this.schemaExampleCounters.set(key, newCount);
      await this.saveSchemaExampleCount(channelMessageId, newCount);
      return;
    }
    
    if (count === 4) {
      // Второе сообщение
      await this.sendMessage(
        'Ну, правда, больше нет примеров 😁',
        replyToMessageId
      );
      this.schemaExampleCounters.set(key, 5);
      await this.saveSchemaExampleCount(channelMessageId, 5);
      return;
    }
    
    // Показываем пример
    const example = SCHEMA_EXAMPLES[count];
    const exampleText = 
      '<b>Пример разбора:</b>\n\n' +
      `<b>💣 Триггер:</b> ${example.trigger}\n\n` +
      `<b>💭 Мысли:</b> ${example.thoughts}\n\n` +
      `<b>🥺 Эмоции:</b> ${example.emotions}\n\n` +
      `<b>💃 Поведение:</b> ${example.behavior}\n\n` +
      `<b>🛠 Коррекция:</b> ${example.correction}`;
    
    // Определяем какую кнопку показывать под примером
    const nextCount = count + 1;
    const messageOptions: any = {};
    
    // Добавляем кнопку "Еще пример" для первых двух примеров (счетчик 0 и 1)
    // Для третьего примера (счетчик 2) кнопка не добавляется
    if (nextCount < 3) {
      messageOptions.reply_markup = {
        inline_keyboard: [[
          { text: 'Еще пример', callback_data: `schema_example_${channelMessageId}` }
        ]]
      };
    }
    
    await this.sendMessage(exampleText, replyToMessageId, messageOptions);
    const newCount = count + 1;
    this.schemaExampleCounters.set(key, newCount);
    
    // Сохраняем счетчик в БД
    await this.saveSchemaExampleCount(channelMessageId, newCount);
  }

  // Сохранение счетчика примеров фильтров в БД
  private async saveFiltersExampleCount(channelMessageId: number, count: number) {
    try {
      const post = getInteractivePost(channelMessageId);
      if (post) {
        const updatedMessageData = {
          ...post.message_data,
          filters_example_count: count
        };
        
        const { db } = await import('./db');
        const update = db.query(`
          UPDATE interactive_posts
          SET message_data = ?
          WHERE channel_message_id = ?
        `);
        update.run(JSON.stringify(updatedMessageData), channelMessageId);
        
        botLogger.debug({ channelMessageId, count }, 'Счетчик примеров фильтров сохранен в БД');
      }
    } catch (error) {
      botLogger.error({ error, channelMessageId }, 'Ошибка сохранения счетчика примеров фильтров');
    }
  }

  // Сохранение счетчика примеров схемы в БД
  private async saveSchemaExampleCount(channelMessageId: number, count: number) {
    try {
      const post = getInteractivePost(channelMessageId);
      if (post) {
        const updatedMessageData = {
          ...post.message_data,
          schema_example_count: count
        };
        
        const { db } = await import('./db');
        const update = db.query(`
          UPDATE interactive_posts
          SET message_data = ?
          WHERE channel_message_id = ?
        `);
        update.run(JSON.stringify(updatedMessageData), channelMessageId);
        
        botLogger.debug({ channelMessageId, count }, 'Счетчик примеров схемы сохранен в БД');
      }
    } catch (error) {
      botLogger.error({ error, channelMessageId }, 'Ошибка сохранения счетчика примеров');
    }
  }

  // Показ фильтров восприятия
  async showFilters(channelMessageId: number, userId: number, replyToMessageId?: number) {
    try {
      // Фильтры восприятия с file_id картинок
      const FILTERS = [
        // Первая группа (6 картинок) - картинки 2-7
        {
          file_id: 'AgACAgIAAxkBAAIF9Wi0ik4AAQHIlLvKfXIAAV9ZsRbvNCAAArn2MRsZmqhJLZzMKg8PIeUBAAMCAAN5AAM2BA',
          title: 'Чтение мыслей',
          description: 'Предполагаем, что знаем о чем думают другие'
        },
        {
          file_id: 'AgACAgIAAxkBAAIF9mi0ik4E7-2nFVd2jxOFJ-ZikrU-AAK79jEbGZqoSXALrK3ECk06AQADAgADeQADNgQ',
          title: 'Черно-белое мышление',
          description: 'Видим только крайности без полутонов'
        },
        {
          file_id: 'AgACAgIAAxkBAAIF92i0ik6EM37s378C9rn_NwVuQpO_AAK89jEbGZqoSdGUmrDZmTnYAQADAgADeQADNgQ',
          title: 'Катастрофизация',
          description: 'Ожидание худшего исхода событий'
        },
        {
          file_id: 'AgACAgIAAxkBAAIF-Gi0ik6gE3_DCCiyYOEAAbZEfBOAYgACvfYxGxmaqEk_b9ajzx_t9gEAAwIAA3kAAzYE',
          title: 'Навешивание ярлыков',
          description: 'Присваиваем себе или другим негативные характеристики'
        },
        {
          file_id: 'AgACAgIAAxkBAAIF-Wi0ik6K52oJUb1sMl7jmLtGagqrAAK_9jEbGZqoSaMTOzeV3bhJAQADAgADeQADNgQ',
          title: 'Сверхобобщение',
          description: 'Используем слова "всегда", "никогда", "все", "никто"'
        },
        {
          file_id: 'AgACAgIAAxkBAAIF-mi0ik4BxNIBSe8o_EGt3UVc5DlkAALA9jEbGZqoSX1oJUCbeGbNAQADAgADeQADNgQ',
          title: 'Обесценивание позитивного',
          description: 'Игнорируем или преуменьшаем хорошее'
        },
        // Вторая группа (6 картинок) - картинки 8-13
        {
          file_id: 'AgACAgIAAxkBAAIF-2i0ik5f4f_vE8HVGhsyuSdXjF4TAALB9jEbGZqoSaSf-vW4Y8h_AQADAgADeQADNgQ',
          title: 'Розовые очки',
          description: 'Идеализируем ситуацию, игнорируя негативные аспекты'
        },
        {
          file_id: 'AgACAgIAAxkBAAIF_Gi0ik6DrRIJ2oQCdcvnczn5Zxf5AALC9jEbGZqoSYwEMIOSyT4bAQADAgADeQADNgQ',
          title: 'Эмоциональное обоснование',
          description: 'Считаем свои чувства доказательством истины'
        },
        {
          file_id: 'AgACAgIAAxkBAAIF_Wi0ik4syr_yJd5IEvaSap4RgjXlAALD9jEbGZqoSRhu44-4826XAQADAgADeQADNgQ',
          title: 'Персонализация',
          description: 'Берем на себя вину за то, что от нас не зависит'
        },
        {
          file_id: 'AgACAgIAAxkBAAIF_mi0ik4QDysr0EUcE7ddA4G0bTOVAALE9jEbGZqoSQY3_YlELhp-AQADAgADeQADNgQ',
          title: 'Избирательное внимание',
          description: 'Фокусируемся только на негативе'
        },
        {
          file_id: 'AgACAgIAAxkBAAIF82i0ij6rJr8gvBFcERakN9mamHr_AAK69jEbGZqoSdBi8J2JaUl9AQADAgADeQADNgQ',
          title: 'Преувеличение',
          description: 'Раздуваем значимость негативных событий'
        },
        {
          file_id: 'AgACAgIAAxkBAAIGzmi024_oBkIH9lBHRljpiIz45X1vAAJt-DEbGZqoSTtoREDebC7PAQADAgADeQADNgQ',
          title: 'Преуменьшение',
          description: 'Минимизируем значимость позитивных событий'
        }
      ];

      // Подготавливаем первую группу из 6 картинок
      const firstGroup = FILTERS.slice(0, 6).map(filter => ({
        type: 'photo' as const,
        media: filter.file_id
      }));

      // Подготавливаем вторую группу из 6 картинок
      const secondGroup = FILTERS.slice(6, 12).map(filter => ({
        type: 'photo' as const,
        media: filter.file_id
      }));

      const sendOptions: any = {};
      if (replyToMessageId) {
        sendOptions.reply_to_message_id = replyToMessageId;
      }

      // Отправляем первую группу
      await this.bot.telegram.sendMediaGroup(this.chatId, firstGroup, sendOptions);

      // Отправляем вторую группу
      await this.bot.telegram.sendMediaGroup(this.chatId, secondGroup, sendOptions);

      botLogger.info({ channelMessageId, userId }, 'Фильтры восприятия отправлены');
      
    } catch (error) {
      botLogger.error({ error, channelMessageId }, 'Ошибка отправки фильтров восприятия');
      // Fallback - отправляем текстовое описание
      await this.showFiltersCards(channelMessageId, userId, replyToMessageId);
    }
  }
}