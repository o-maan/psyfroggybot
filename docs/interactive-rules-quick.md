# Шпаргалка: Интерактивные посты

## 🎯 Главное правило
После поста ВСЕ сообщения идут в комментарии через reply

## ✅ Правильно
```typescript
// 1. Всегда бери chatId из контекста
const replyToChatId = ctx.chat.id;
const handler = new DeepWorkHandler(bot, replyToChatId);

// 2. ТЕКСТ - через reply_parameters
await bot.telegram.sendMessage(chatId, text, {
  reply_parameters: { message_id: replyTo }
});

// 3. ФОТО - через reply_to_message_id (НЕ reply_parameters!)
await bot.telegram.sendPhoto(chatId, imageBuffer, {
  caption: text,
  reply_to_message_id: replyToMessageId  // ✅ ВАЖНО!
});

// 4. message_thread_id ТОЛЬКО для первого сообщения
await bot.telegram.sendMessage(CHAT_ID, 'Первое задание', {
  message_thread_id: messageThreadId  // только тут!
});
```

## ❌ Неправильно
```typescript
// НЕ используй message_thread_id при ответах
reply_parameters: { message_id: replyTo },
message_thread_id: threadId  // ❌ вызовет ошибку!

// НЕ используй getChatId() 
new DeepWorkHandler(bot, getChatId()); // ❌

// НЕ используй reply_parameters для фото!
await bot.telegram.sendPhoto(chatId, photo, {
  reply_parameters: { message_id: replyTo }  // ❌ уйдет в группу!
});
```

## 📸 КРИТИЧЕСКИ ВАЖНО ДЛЯ ФОТО
- **sendMessage** → используй `reply_parameters`
- **sendPhoto** → используй `reply_to_message_id`
- Иначе фото уйдет в основную группу, а не в комментарии!

## 📂 Где смотреть
- `scheduler.ts` → `handleInteractiveUserResponse()` - маршрутизация
- `deep-work-handler.ts` → `sendMessage()` - правильный метод отправки
- `text.ts` → `replyToChatId = ctx.chat.id` - откуда брать chatId

## 🔄 Порядок работы
1. Пост → канал (картинка + "Переходи в комментарии")
2. Первое задание → автоматом в комментарии (с message_thread_id)
3. Ответ юзера → бот отвечает через reply_parameters (текст) или reply_to_message_id (фото)
4. Все дальше → только reply_parameters/reply_to_message_id, без thread_id