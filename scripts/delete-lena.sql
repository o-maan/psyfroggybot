-- Скрипт для ПОЛНОГО удаления Лены из базы данных
-- Запускать на продакшн: sqlite3 /var/www/databases/psy_froggy_bot/froggy.db < delete-lena.sql

-- Удаляем пользователя Лену (ID: 716928723) полностью
DELETE FROM users WHERE chat_id = 716928723;

-- Проверяем результат (не должно быть записей)
SELECT chat_id, username, name FROM users WHERE chat_id = 716928723;

-- Показываем всех оставшихся пользователей
SELECT chat_id, username, name, dm_enabled, channel_enabled FROM users WHERE chat_id > 0;
