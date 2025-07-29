#!/bin/bash

echo "🧪 Тестирование команд бота..."
echo "================================"

# Функция для проверки команды в логах
check_command() {
    local cmd=$1
    echo -n "Проверка команды $cmd... "
    
    # Ищем команду в последних 50 строках лога
    if tail -n 50 bot.log | grep -q "$cmd"; then
        echo "✅ РАБОТАЕТ"
        return 0
    else
        echo "❌ НЕ НАЙДЕНА"
        return 1
    fi
}

# Ждем немного после запуска
sleep 2

# Проверяем команды
check_command "/ping"
check_command "/test_button"
check_command "/fro"

echo "================================"
echo "Последние логи с командами:"
tail -n 20 bot.log | grep -E "(Получена команда|updateType.*message)" | tail -5