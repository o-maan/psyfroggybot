-- Скрипт для очистки channel_enabled и заполнения channel_id
--
-- ВАЖНО: В основном боте целевой пользователь = Алекс (5153477378)
-- В тестовом боте целевой пользователь будет другой
--
-- Использование на продакшене (основной бот):
-- sqlite3 /var/www/databases/psy_froggy_bot/froggy.db < fix-channel-enabled.sql
--
-- Использование локально (тестовый бот):
-- Замените 5153477378 на ID тестового пользователя и выполните

-- Показываем текущее состояние ПЕРЕД изменениями
SELECT 'ПЕРЕД изменениями:' as step;
SELECT chat_id, username, dm_enabled, channel_enabled, channel_id
FROM users
WHERE chat_id > 0
ORDER BY chat_id;

-- 1. Отключаем channel_enabled у всех пользователей кроме целевого (Алекса в основном боте)
UPDATE users
SET channel_enabled = 0
WHERE chat_id > 0
  AND chat_id != 5153477378;

-- 2. Заполняем channel_id для целевого пользователя (Алекса)
-- ID канала Алекса в основном боте: -1002405993986
UPDATE users
SET channel_id = -1002405993986
WHERE chat_id = 5153477378;

-- Показываем результат ПОСЛЕ изменений
SELECT 'ПОСЛЕ изменений:' as step;
SELECT chat_id, username, dm_enabled, channel_enabled, channel_id
FROM users
WHERE chat_id > 0
ORDER BY chat_id;

-- Выводим итоговую статистику
SELECT 'ИТОГО:' as step;
SELECT
  COUNT(*) as total_users,
  SUM(CASE WHEN channel_enabled = 1 THEN 1 ELSE 0 END) as users_with_channel_enabled,
  SUM(CASE WHEN channel_id IS NOT NULL THEN 1 ELSE 0 END) as users_with_channel_id,
  SUM(CASE WHEN dm_enabled = 1 THEN 1 ELSE 0 END) as users_with_dm
FROM users
WHERE chat_id > 0;
