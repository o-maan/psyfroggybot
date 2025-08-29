# Паттерн интерактивного взаимодействия с пользователем

## Основной принцип

После публикации поста в канале ВСЯ работа с пользователем переходит в комментарии к этому посту. Это критически важно для правильной работы!

## Структура взаимодействия

### 1. Публикация поста
```typescript
// Пост в канале содержит только:
const channelMessage = await bot.telegram.sendPhoto(CHANNEL_ID, imageBuffer, {
  caption: `${messageData.inspiring_text}\n\nПереходи в комментарии и продолжим 😉`,
  reply_markup: {
    inline_keyboard: [[
      { text: '💬 Комментарии', url: `https://t.me/c/${CHAT_ID.toString().slice(4)}/${messageThreadId}` }
    ]]
  }
});
```

### 2. Первое сообщение в комментариях
```typescript
// Сразу после поста автоматически отправляем первое задание в комментарии
const firstMessage = await bot.telegram.sendMessage(
  CHAT_ID,  // ID группы обсуждений
  'Текст первого задания',
  {
    message_thread_id: messageThreadId,  // ВАЖНО: указываем thread для отправки в правильную ветку
    reply_markup: {
      inline_keyboard: [[
        { text: 'Пропустить', callback_data: `skip_task1_${channelMessageId}` }
      ]]
    }
  }
);
```

### 3. Обработка ответов пользователя

#### ПРАВИЛЬНЫЙ паттерн (универсальный для всех сценариев):
```typescript
// В обработчике текстовых сообщений
const replyToChatId = ctx.chat.id; // ВСЕГДА используем чат, откуда пришло сообщение

// В классе-обработчике (DeepWorkHandler, SimplifiedHandler и т.д.)
class Handler {
  private chatId: number; // Сохраняем replyToChatId при создании
  
  constructor(bot: Telegraf, chatId: number) {
    this.bot = bot;
    this.chatId = chatId; // Это replyToChatId из текстового обработчика
  }
  
  // Универсальный метод отправки
  private async sendMessage(text: string, replyToMessageId?: number, options = {}) {
    const sendOptions: any = {
      parse_mode: options.parse_mode || 'HTML',
      ...options
    };
    
    // КЛЮЧЕВОЙ МОМЕНТ: используем reply_parameters для ответа в треде
    if (replyToMessageId) {
      sendOptions.reply_parameters = {
        message_id: replyToMessageId
      };
    }
    
    // Отправляем в тот же чат, откуда пришло сообщение
    return await this.bot.telegram.sendMessage(this.chatId, text, sendOptions);
  }
}
```

### 4. Обработка кнопок

```typescript
// В обработчике кнопок
bot.action(/pattern/, async (ctx) => {
  const chatId = ctx.chat?.id;
  
  // Создаем обработчик с правильным chatId
  const handler = new DeepWorkHandler(bot, chatId);
  
  // Обработчик сам позаботится об отправке в правильный чат
  await handler.handleButtonAction();
});
```

## Важные моменты

### ❌ НЕПРАВИЛЬНО:
```typescript
// НЕ используйте message_thread_id при ответах в комментариях
await bot.telegram.sendMessage(chatId, text, {
  message_thread_id: threadId, // ЭТО ВЫЗОВЕТ ОШИБКУ!
  reply_parameters: { message_id: replyTo }
});

// НЕ используйте getChatId() для ответов
const handler = new Handler(bot, getChatId()); // НЕВЕРНО!

// НЕ используйте reply_parameters для sendPhoto!
await bot.telegram.sendPhoto(chatId, photo, {
  reply_parameters: { message_id: replyTo } // ФОТО УЙДЕТ В ГРУППУ!
});
```

### ✅ ПРАВИЛЬНО:
```typescript
// Для текста используйте reply_parameters
await bot.telegram.sendMessage(chatId, text, {
  reply_parameters: { message_id: replyTo }
});

// Для фото используйте reply_to_message_id
await bot.telegram.sendPhoto(chatId, photo, {
  caption: text,
  reply_to_message_id: replyToMessageId // КРИТИЧЕСКИ ВАЖНО!
});

// Используйте chatId из контекста сообщения
const replyToChatId = ctx.chat.id;
const handler = new Handler(bot, replyToChatId); // ПРАВИЛЬНО!
```

### 📸 КРИТИЧЕСКОЕ ПРАВИЛО ДЛЯ ФОТО
- **sendMessage** → `reply_parameters`
- **sendPhoto** → `reply_to_message_id`
- Это разные API! Если перепутать - фото уйдет в основную группу вместо комментариев!

## Последовательность диалога

1. **Пост в канале** → картинка + текст + "Переходи в комментарии"
2. **Первое задание** → автоматически в комментарии с кнопкой пропуска
3. **Ответ пользователя** → бот отвечает на сообщение пользователя
4. **Следующее задание** → бот продолжает диалог, отвечая на предыдущее сообщение пользователя
5. **Кнопки** → при нажатии кнопки бот отвечает на сообщение с кнопкой

## Состояния и их обработка

### Упрощенный сценарий:
- `waiting_negative` → ждем ответа на выгрузку негатива
- `waiting_positive` → ждем плюшек
- `waiting_practice` → ждем выполнения практики

### Глубокая работа:
- `deep_waiting_situation_choice` → выбор ситуации для разбора
- `deep_waiting_filters_start` → ожидание нажатия "Погнали"
- `deep_waiting_thoughts` → ждем описания мыслей
- `deep_waiting_distortions` → ждем определения искажений
- `deep_waiting_rational` → ждем рациональной реакции

## Fallback при ошибках LLM

Если Hugging Face возвращает ошибку, используем заготовленные тексты:
- Упрощенный сценарий → стандартные тексты заданий
- Глубокая работа → переход на фильтры восприятия с fallback текстами

## Ключевые файлы

1. **src/scheduler.ts** - `handleInteractiveUserResponse()` - основная логика маршрутизации
2. **src/handlers/messages/text.ts** - обработка текстовых сообщений
3. **src/handlers/callbacks/** - обработчики кнопок
4. **src/deep-work-handler.ts** - логика глубокой работы
5. **src/db.ts** - функции работы с состояниями постов

## Проверка правильности реализации

1. Все сообщения после поста должны появляться в комментариях
2. Бот должен отвечать на сообщения пользователя (reply)
3. При нажатии кнопок ответ идет на сообщение с кнопкой
4. Не должно быть ошибок "message thread not found"
5. Сообщения не должны уходить в личку или основную группу