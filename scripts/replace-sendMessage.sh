#!/bin/bash

# Скрипт для замены bot.telegram.sendMessage на sendToUser
# Использование: bash scripts/replace-sendMessage.sh

echo "🔍 Поиск файлов с bot.telegram.sendMessage..."

# Список файлов для обработки (исключаем документацию, бэкапы, node_modules)
FILES=$(grep -rl "bot\.telegram\.sendMessage" src/ \
  --include="*.ts" \
  --exclude="*.test.ts" \
  --exclude="*.backup.*" \
  | grep -v "send-to-user.ts")

if [ -z "$FILES" ]; then
  echo "✅ Все файлы уже используют sendToUser!"
  exit 0
fi

echo "📝 Найдено файлов для обработки:"
echo "$FILES" | nl

echo ""
echo "⚠️  ВНИМАНИЕ: Этот скрипт требует РУЧНОЙ проверки каждой замены!"
echo "Файлы будут обработаны, но потребуется:"
echo "1. Добавить импорт: import { sendToUser } from './utils/send-to-user'"
echo "2. Определить правильный userId для каждого вызова"
echo "3. Заменить третий параметр на userId (или null для системных сообщений)"
echo ""
read -p "Продолжить? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Отменено."
  exit 1
fi

echo ""
echo "📋 Создаю отчёт о необходимых изменениях..."

# Создаём отчёт
REPORT_FILE="scripts/sendMessage-replacement-report.txt"
echo "Отчёт о замене bot.telegram.sendMessage на sendToUser" > "$REPORT_FILE"
echo "Дата: $(date)" >> "$REPORT_FILE"
echo "======================================================" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

for FILE in $FILES; do
  echo "Файл: $FILE" >> "$REPORT_FILE"
  echo "---" >> "$REPORT_FILE"

  # Находим все строки с bot.telegram.sendMessage
  grep -n "bot\.telegram\.sendMessage" "$FILE" | while read -r line; do
    LINE_NUM=$(echo "$line" | cut -d: -f1)
    CONTENT=$(echo "$line" | cut -d: -f2-)

    echo "  Строка $LINE_NUM:" >> "$REPORT_FILE"
    echo "    Было: $CONTENT" >> "$REPORT_FILE"
    echo "    TODO: Определить userId для этого вызова" >> "$REPORT_FILE"
    echo "    Рекомендация: await sendToUser(bot, chatId, userId, text, options)" >> "$REPORT_FILE"
    echo "" >> "$REPORT_FILE"
  done

  echo "" >> "$REPORT_FILE"
done

echo "✅ Отчёт сохранён в: $REPORT_FILE"
echo ""
echo "📖 Следующие шаги:"
echo "1. Изучи отчёт: cat $REPORT_FILE"
echo "2. Для каждого файла:"
echo "   - Добавь импорт: import { sendToUser } from './utils/send-to-user'"
echo "   - Определи правильный userId из контекста"
echo "   - Замени bot.telegram.sendMessage на sendToUser"
echo "3. Запусти тесты: bun run lint"
echo ""
echo "💡 Подсказка: используй Claude для автоматической замены в каждом файле"
