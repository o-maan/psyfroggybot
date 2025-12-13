-- Скрипт для восстановления настроек доставки для пользователей
-- Запускать на продакшн сервере через: sqlite3 /var/www/databases/psy_froggy_bot/froggy.db < restore-user-settings.sql

-- 1. Восстанавливаем настройки для Алекса (основной бот, ID: 5153477378)
UPDATE users
SET dm_enabled = 1,
    channel_enabled = 1,
    channel_id = -1002405993986
WHERE chat_id = 5153477378;

-- 2. Восстанавливаем настройки для Оли (тестовый бот, ID: 476561547)
UPDATE users
SET dm_enabled = 1,
    channel_enabled = 1,
    channel_id = -1002846400650
WHERE chat_id = 476561547;

-- 3. Для ВСЕХ остальных пользователей: включаем только ЛС (отключаем канал)
UPDATE users
SET dm_enabled = 1,
    channel_enabled = 0,
    channel_id = NULL
WHERE chat_id > 0
  AND chat_id != 5153477378
  AND chat_id != 476561547;

-- Проверяем результат
SELECT chat_id, username, name, dm_enabled, channel_enabled, channel_id
FROM users
WHERE chat_id IN (5153477378, 476561547)
ORDER BY chat_id;
