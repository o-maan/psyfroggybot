import { Telegraf } from 'telegraf';
import { readFileSync } from 'fs';
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
  private chatId: number; // ID группы обсуждений для отправки сообщений

  constructor(bot: Telegraf, chatId?: number) {
    this.bot = bot;
    // Если chatId не передан, используем значение из env
    this.chatId = chatId || Number(process.env.CHAT_ID) || -1002798126153;
  }

  // Анализ ответа пользователя и выбор техники
  async analyzeUserResponse(channelMessageId: number, userText: string, userId: number, replyToMessageId?: number): Promise<void> {
    try {
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

      // Если ситуаций несколько - спрашиваем какую разберем
      if (analysis.situations_count > 1) {
        await this.askWhichSituation(channelMessageId, analysis.situations, userId, replyToMessageId);
      } else {
        // Сразу переходим к технике
        await this.startTechnique(channelMessageId, analysis.recommended_technique.type, userId, replyToMessageId);
      }
      
    } catch (error) {
      botLogger.error({ error, channelMessageId }, 'Ошибка анализа ответа пользователя');
      // Fallback - используем фильтры восприятия
      await this.startTechnique(channelMessageId, 'percept_filters', userId, replyToMessageId);
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
    
    const sendOptions: any = {
      reply_markup: keyboard,
      parse_mode: 'HTML'
    };

    if (replyToMessageId) {
      sendOptions.reply_parameters = {
        message_id: replyToMessageId
      };
    }
    
    const message = await this.bot.telegram.sendMessage(
      this.chatId,
      'Какую ситуацию разберем подробнее?',
      sendOptions
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
    } else if (techniqueType === 'abc') {
      // TODO: реализовать ABC технику
      const sendOptions: any = {
        parse_mode: 'HTML'
      };
      
      if (replyToMessageId) {
        sendOptions.reply_parameters = {
          message_id: replyToMessageId
        };
      }
      
      await this.bot.telegram.sendMessage(this.chatId, 'ABC техника в разработке', sendOptions);
    }
  }

  // Начинаем работу с фильтрами восприятия
  private async startPerceptFilters(channelMessageId: number, userId: number, replyToMessageId?: number) {
    try {
      // Отправляем объяснение и картинку
      const text = 'Давай разберем через фильтры восприятия';
      
      // Пробуем отправить картинку
      try {
        const imagePath = 'assets/images/percept-filters-info.jpg';
        const image = readFileSync(imagePath);
        
        const sendOptions: any = {
          caption: text,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[
              { text: '🚀 Погнали', callback_data: `deep_filters_start_${channelMessageId}` }
            ]]
          }
        };
        
        if (replyToMessageId) {
          sendOptions.reply_parameters = {
            message_id: replyToMessageId
          };
        }
        
        const message = await this.bot.telegram.sendPhoto(this.chatId, 
          { source: image },
          sendOptions
        );

        updateInteractivePostState(channelMessageId, 'deep_waiting_filters_start');
      } catch (imageError) {
        // Если картинки нет - отправляем только текст
        const sendOptions: any = {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[
              { text: '🚀 Погнали', callback_data: `deep_filters_start_${channelMessageId}` }
            ]]
          }
        };
        
        if (replyToMessageId) {
          sendOptions.reply_parameters = {
            message_id: replyToMessageId
          };
        }
        
        const message = await this.bot.telegram.sendMessage(this.chatId, text, sendOptions);

        updateInteractivePostState(channelMessageId, 'deep_waiting_filters_start');
      }
    } catch (error) {
      botLogger.error({ error, channelMessageId }, 'Ошибка начала фильтров восприятия');
    }
  }

  // Обработчик кнопки "Погнали" для фильтров
  async handleFiltersStart(channelMessageId: number, userId: number, replyToMessageId?: number) {
    const sendOptions: any = {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[
          { text: '💡 Показать пример', callback_data: `deep_filters_example_thoughts_${channelMessageId}` }
        ]]
      }
    };
    
    if (replyToMessageId) {
      sendOptions.reply_parameters = {
        message_id: replyToMessageId
      };
    }
    
    const message = await this.bot.telegram.sendMessage(this.chatId,
      'Какие мысли возникли в выбранном событии?',
      sendOptions
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
    const count = this.exampleCounters.get(key) || 0;

    if (count >= 3) {
      const sendOptions: any = {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: '🎴 Показать фильтры', callback_data: `deep_show_filters_${channelMessageId}` }
          ]]
        }
      };
      
      if (replyToMessageId) {
        sendOptions.reply_parameters = {
          message_id: replyToMessageId
        };
      }
      
      // 4-е нажатие - показываем исходное сообщение
      if (count === 3) {
        await this.bot.telegram.sendMessage(this.chatId,
          'Больше примеров можешь посмотреть в карточках <b>Фильтры восприятия</b>',
          sendOptions
        );
        
        // Увеличиваем счетчик для перехода к следующему сообщению
        this.exampleCounters.set(key, count + 1);
      } else {
        // 5-е и последующие нажатия - показываем повторяющееся сообщение
        await this.bot.telegram.sendMessage(this.chatId,
          'Примеры смотри выше или открывай фильтры восприятия',
          sendOptions
        );
        // Не увеличиваем счетчик, чтобы это сообщение повторялось
      }
    } else {
      // Показываем пример
      const example = PERCEPT_FILTERS_EXAMPLES[count];
      const text = `<b>Мысли:</b> ${example.thoughts}\n\n<b>Искажения:</b> ${example.distortions}\n\n<b>Рациональная реакция:</b> ${example.rational}`;
      
      const sendOptions: any = { parse_mode: 'HTML' };
      
      if (replyToMessageId) {
        sendOptions.reply_parameters = {
          message_id: replyToMessageId
        };
      }
      
      await this.bot.telegram.sendMessage(this.chatId, text, sendOptions);
      
      this.exampleCounters.set(key, count + 1);
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
    // Переходим к искажениям
    const sendOptions: any = {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '💡 Показать пример', callback_data: `deep_filters_example_distortions_${channelMessageId}` }],
          [{ text: '🎴 Показать фильтры', callback_data: `deep_show_filters_${channelMessageId}` }]
        ]
      }
    };
    
    if (replyToMessageId) {
      sendOptions.reply_parameters = {
        message_id: replyToMessageId
      };
    }
    
    const message = await this.bot.telegram.sendMessage(this.chatId,
      'Какие искажения ты здесь видишь?',
      sendOptions
    );

    updateInteractivePostState(channelMessageId, 'deep_waiting_distortions', {
      user_task2_message_id: message.message_id // Используем существующее поле для ID сообщения бота
    });

    // Используем тот же счетчик для примеров искажений
    const key = `distortions_${channelMessageId}`;
    this.exampleCounters.set(key, this.exampleCounters.get(`thoughts_${channelMessageId}`) || 0);
  }

  // Обработка ответа на искажения
  async handleDistortionsResponse(channelMessageId: number, userText: string, userId: number, replyToMessageId?: number) {
    // Переходим к рациональной реакции
    const sendOptions: any = {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '💡 Показать пример', callback_data: `deep_filters_example_rational_${channelMessageId}` }],
          [{ text: '🎴 Показать фильтры', callback_data: `deep_show_filters_${channelMessageId}` }]
        ]
      }
    };
    
    if (replyToMessageId) {
      sendOptions.reply_parameters = {
        message_id: replyToMessageId
      };
    }
    
    const message = await this.bot.telegram.sendMessage(this.chatId,
      'А теперь постарайся написать рациональную реакцию',
      sendOptions
    );

    updateInteractivePostState(channelMessageId, 'deep_waiting_rational', {
      bot_task3_message_id: message.message_id // Используем существующее поле
    });
  }

  // Показ карточек фильтров
  async showFiltersCards(channelMessageId: number, userId: number, replyToMessageId?: number) {
    try {
      // Пробуем отправить картинки с фильтрами
      const filterImages = [
        'assets/images/filters-1.jpg',
        'assets/images/filters-2.jpg',
        'assets/images/filters-3.jpg'
      ];

      for (const imagePath of filterImages) {
        try {
          const image = readFileSync(imagePath);
          const sendOptions: any = {};
          
          if (replyToMessageId) {
            sendOptions.reply_parameters = {
              message_id: replyToMessageId
            };
          }
          
          await this.bot.telegram.sendPhoto(this.chatId, { source: image }, sendOptions);
        } catch (err) {
          // Пропускаем если картинки нет
          continue;
        }
      }
    } catch (error) {
      // Если картинок нет - отправляем текстовое описание
      const sendOptions: any = { parse_mode: 'HTML' };
      
      if (replyToMessageId) {
        sendOptions.reply_parameters = {
          message_id: replyToMessageId
        };
      }
      
      await this.bot.telegram.sendMessage(this.chatId, 
        '<b>Основные когнитивные искажения:</b>\n\n' +
        '🔮 <b>Чтение мыслей</b> - предполагаем, что знаем, о чем думают другие\n\n' +
        '💣 <b>Катастрофизация</b> - ожидаем худшего исхода событий\n\n' +
        '🎯 <b>Персонализация</b> - берем на себя вину за то, что от нас не зависит\n\n' +
        '♾ <b>Обобщение</b> - используем слова "всегда", "никогда", "все", "никто"\n\n' +
        '📈 <b>Преувеличение/преуменьшение</b> - искажаем значимость событий\n\n' +
        '⚫⚪ <b>Черно-белое мышление</b> - видим только крайности без полутонов',
        sendOptions
      );
    }
  }
}