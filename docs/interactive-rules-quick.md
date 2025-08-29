# Шпаргалка: Интерактивные посты

## 🎯 Главное правило
После поста ВСЕ сообщения идут в комментарии через reply

## ✅ Правильно
```typescript
// 1. Всегда бери chatId из контекста
const replyToChatId = ctx.chat.id;
const handler = new DeepWorkHandler(bot, replyToChatId);

// 2. Отвечай только через reply_parameters
await bot.telegram.sendMessage(chatId, text, {
  reply_parameters: { message_id: replyTo }
});

// 3. message_thread_id ТОЛЬКО для первого сообщения
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
```

## 📂 Где смотреть
- `scheduler.ts` → `handleInteractiveUserResponse()` - маршрутизация
- `deep-work-handler.ts` → `sendMessage()` - правильный метод отправки
- `text.ts` → `replyToChatId = ctx.chat.id` - откуда брать chatId

## 🔄 Порядок работы
1. Пост → канал (картинка + "Переходи в комментарии")
2. Первое задание → автоматом в комментарии (с message_thread_id)
3. Ответ юзера → бот отвечает через reply_parameters
4. Все дальше → только reply_parameters, без thread_id