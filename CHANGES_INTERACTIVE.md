# Изменения для упрощенной интерактивной версии бота

## Основные изменения

### 1. Новая логика постов в канал

- **Основной пост** содержит только:
  - Изображение лягушки
  - Вдохновляющий текст от LLM
  - Текст: "Переходи в комментарии и продолжим 😉"

- **Первое задание** автоматически публикуется как комментарий сразу после основного поста:
  - "1. Выгрузка неприятных переживаний (ситуация+эмоция)"
  - Дополнительный текст от LLM
  - Случайная кнопка пропуска из списка

### 2. Обновленные компоненты

#### scheduler.ts
- Новый метод `getRandomSkipButtonText()` - возвращает случайный текст для кнопки пропуска
- Обновлен метод `sendInteractiveDailyMessage()`:
  - Отправляет основной пост без кнопок
  - Автоматически постит первое задание как комментарий с кнопкой
- Новый метод `handleSkipNegative()` - обработка кнопки пропуска первого задания
- Обновлен метод `buildInteractiveMessage()` - возвращает только вдохновляющий текст

#### bot.ts
- Удалена команда `/skip` (больше не нужна)
- Добавлен обработчик для кнопки `daily_skip_negative`
- Сохранена вся логика обработки ответов пользователей в комментариях

### 3. Список случайных кнопок пропуска

```javascript
✅ Все ок - пропустить
👌 Все хорошо - пропустить
🌟 Все отлично - пропустить
💚 Все в порядке - пропустить
🌈 Все супер - пропустить
✨ Все замечательно - пропустить
🍀 Все чудесно - пропустить
🌺 Все прекрасно - пропустить
🎯 Все на месте - пропустить
🌸 Все классно - пропустить
```

### 4. Логика работы

1. В 22:00 публикуется основной пост в канал
2. Сразу же автоматически публикуется первое задание как комментарий
3. Пользователь может:
   - Написать ответ в комментариях
   - Нажать кнопку пропуска
4. Вся дальнейшая логика происходит в комментариях согласно new-bot-logic

### 5. Тестирование

Создан скрипт `test-interactive.ts` для проверки новой функциональности:
```bash
bun run test-interactive.ts
```

## Важные моменты

- Команда `/fro` уже обновлена для использования новой логики
- Все ответы пользователей обрабатываются в комментариях
- Сохранена вся существующая интерактивная логика (анализ ответов, уточняющие вопросы и т.д.)
- Типы TypeScript исправлены (использование reply_parameters вместо reply_to_message_id)