# ⛔ КРИТИЧЕСКИЕ ПРАВИЛА - НЕ ЛОМАТЬ!

## 🚨 ПЕРЕД ЛЮБЫМИ ИЗМЕНЕНИЯМИ:
1. **ПРОЧИТАЙ ЭТИ ПРАВИЛА**
2. **ПРОВЕРЬ КАК РАБОТАЕТ СЕЙЧАС**
3. **НЕ МЕНЯЙ ТО, ЧТО УЖЕ РАБОТАЕТ**

## 📸 Отправка в комментарии к посту

### ✅ ПРОВЕРЕНО И РАБОТАЕТ:
```typescript
// ТЕКСТ - через reply_parameters
await bot.telegram.sendMessage(chatId, text, {
  reply_parameters: { message_id: replyToMessageId }
});

// ФОТО - через reply_to_message_id (НЕ reply_parameters!!!)
await bot.telegram.sendPhoto(chatId, imageBuffer, {
  caption: text,
  reply_to_message_id: replyToMessageId  // ⚠️ НЕ reply_parameters!
});
```

### ❌ НЕ ДЕЛАЙ ТАК:
- `sendPhoto` с `reply_parameters` = фото уйдет в группу
- `message_thread_id` при ответах = ошибка
- `getChatId()` вместо `ctx.chat.id` = неверная маршрутизация

## 🔍 Перед изменением ВСЕГДА:
1. Найди аналогичный работающий код (grep/search)
2. Посмотри как реализовано в упрощенном сценарии
3. Проверь существующие паттерны в `scheduler.ts`
4. НЕ ИЗОБРЕТАЙ новые методы - используй существующие

## 🛑 НЕ ТРОГАЙ без крайней необходимости:
- Маршрутизацию сообщений (`replyToChatId`, `chatId`)
- Логику `handleInteractiveUserResponse`
- Способы отправки сообщений (sendMessage/sendPhoto)
- Параметры reply (reply_parameters vs reply_to_message_id)

## 📝 Если пользователь говорит "не работает":
1. Спроси КОНКРЕТНО что не работает
2. Проверь логи
3. НЕ МЕНЯЙ всю логику - найди точечную проблему
4. Используй существующие работающие паттерны

## 🎯 Главный принцип:
**НЕ ЛОМАЙ ТО, ЧТО РАБОТАЕТ!**

Если что-то работает - не трогай. Если нужно добавить функционал - добавляй, не меняя существующее.