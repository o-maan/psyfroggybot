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
    try {
      botLogger.info({
        channelMessageId,
        userId,
        replyToMessageId,
        hasReplyId: !!replyToMessageId
      }, 'analyzeUserResponse вызван с параметрами');
      
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
      try {
        await this.startTechnique(channelMessageId, 'percept_filters', userId, replyToMessageId);
      } catch (fallbackError) {
        botLogger.error({ 
          error: fallbackError, 
          channelMessageId,
          originalError: error 
        }, 'Ошибка при попытке fallback на фильтры восприятия');
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
    } else if (techniqueType === 'abc') {
      // TODO: реализовать ABC технику
      await this.sendMessage('ABC техника в разработке', replyToMessageId);
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
    const count = this.exampleCounters.get(key) || 0;

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
        this.exampleCounters.set(key, count + 1);
      } else if (count === 4) {
        // 5-е нажатие - показываем финальное сообщение и устанавливаем счетчик в 5
        await this.bot.telegram.sendMessage(this.chatId,
          'Примеры смотри выше или открывай фильтры восприятия',
          sendOptions
        );
        // Устанавливаем счетчик в 5, чтобы кнопки стали неактивными
        this.exampleCounters.set(key, 5);
      }
    } else {
      // Показываем пример
      const example = PERCEPT_FILTERS_EXAMPLES[count];
      const text = `<b>Мысли:</b> ${example.thoughts}\n\n<b>Искажения:</b> ${example.distortions}\n\n<b>Рациональная реакция:</b> ${example.rational}`;
      
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

  // Показ фильтров восприятия
  async showFilters(channelMessageId: number, userId: number, replyToMessageId?: number) {
    try {
      // Фильтры восприятия с file_id картинок
      const FILTERS = [
        // Первая группа (6 картинок)
        {
          file_id: 'AgACAgIAAxkBAAIF9Wi0ik4AAQHIlLvKfXIAAV9ZsRbvNCAAArn2MRsZmqhJLZzMKg8PIeUBAAMCAAN5AAM2BA',
          title: 'Катастрофизация',
          description: 'Ожидание худшего исхода событий'
        },
        {
          file_id: 'AgACAgIAAxkBAAIF9mi0ik4E7-2nFVd2jxOFJ-ZikrU-AAK79jEbGZqoSXALrK3ECk06AQADAgADeQADNgQ',
          title: 'Чтение мыслей',
          description: 'Предполагаем, что знаем о чем думают другие'
        },
        {
          file_id: 'AgACAgIAAxkBAAIF92i0ik6EM37s378C9rn_NwVuQpO_AAK89jEbGZqoSdGUmrDZmTnYAQADAgADeQADNgQ',
          title: 'Персонализация',
          description: 'Берем на себя вину за то, что от нас не зависит'
        },
        {
          file_id: 'AgACAgIAAxkBAAIF-Gi0ik6gE3_DCCiyYOEAAbZEfBOAYgACvfYxGxmaqEk_b9ajzx_t9gEAAwIAA3kAAzYE',
          title: 'Обобщение',
          description: 'Используем слова "всегда", "никогда", "все", "никто"'
        },
        {
          file_id: 'AgACAgIAAxkBAAIF-Wi0ik6K52oJUb1sMl7jmLtGagqrAAK_9jEbGZqoSaMTOzeV3bhJAQADAgADeQADNgQ',
          title: 'Черно-белое мышление',
          description: 'Видим только крайности без полутонов'
        },
        {
          file_id: 'AgACAgIAAxkBAAIF-mi0ik4BxNIBSe8o_EGt3UVc5DlkAALA9jEbGZqoSX1oJUCbeGbNAQADAgADeQADNgQ',
          title: 'Преувеличение/преуменьшение',
          description: 'Искажаем значимость событий'
        },
        // Вторая группа (6 картинок)
        {
          file_id: 'AgACAgIAAxkBAAIF-2i0ik5f4f_vE8HVGhsyuSdXjF4TAALB9jEbGZqoSaSf-vW4Y8h_AQADAgADeQADNgQ',
          title: 'Эмоциональное обоснование',
          description: 'Считаем свои чувства доказательством истины'
        },
        {
          file_id: 'AgACAgIAAxkBAAIF_Gi0ik6DrRIJ2oQCdcvnczn5Zxf5AALC9jEbGZqoSYwEMIOSyT4bAQADAgADeQADNgQ',
          title: 'Навешивание ярлыков',
          description: 'Присваиваем себе или другим негативные характеристики'
        },
        {
          file_id: 'AgACAgIAAxkBAAIF_Wi0ik4syr_yJd5IEvaSap4RgjXlAALD9jEbGZqoSRhu44-4826XAQADAgADeQADNgQ',
          title: 'Долженствование',
          description: 'Требования к себе и другим через "должен", "обязан"'
        },
        {
          file_id: 'AgACAgIAAxkBAAIF_mi0ik4QDysr0EUcE7ddA4G0bTOVAALE9jEbGZqoSQY3_YlELhp-AQADAgADeQADNgQ',
          title: 'Ментальный фильтр',
          description: 'Фокусируемся только на негативе'
        },
        {
          file_id: 'AgACAgIAAxkBAAIF82i0ij6rJr8gvBFcERakN9mamHr_AAK69jEbGZqoSdBi8J2JaUl9AQADAgADeQADNgQ',
          title: 'Обесценивание позитива',
          description: 'Игнорируем или преуменьшаем хорошее'
        },
        {
          file_id: 'AgACAgIAAxkBAAIF9Gi0ij7wfJoLrBApRaBXfRSeKB2DAAK-9jEbGZqoSYqi4i1O6U0lAQADAgADeQADNgQ',
          title: 'Туннельное видение',
          description: 'Видим только один аспект ситуации'
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