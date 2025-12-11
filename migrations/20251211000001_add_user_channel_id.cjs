/**
 * Миграция: Добавление channel_id для каждого пользователя
 *
 * ПРОБЛЕМА:
 * Раньше использовался глобальный CHANNEL_ID для всех пользователей
 * Если у пользователя был channel_enabled=1, его посты попадали в чужой канал!
 *
 * РЕШЕНИЕ:
 * Добавляем поле channel_id для каждого пользователя ИНДИВИДУАЛЬНО
 * Если channel_id = NULL → пользователь не имеет канала → отправка в ЛС
 * Если channel_id заполнен → пользователь имеет свой канал → отправка в этот канал
 *
 * ВАЖНО:
 * В основном боте: только Алекс (5153477378) имеет channel_id
 * В тестовом боте: только тестовый пользователь имеет channel_id
 * У всех остальных channel_id = NULL
 */

exports.up = async function(knex) {
  // Добавляем поле channel_id (BIGINT для Telegram ID)
  await knex.schema.table('users', function(table) {
    table.bigInteger('channel_id').nullable().comment('ID канала пользователя (NULL = нет канала)');
  });

  // Для существующих пользователей с channel_enabled=1 нужно ВРУЧНУЮ заполнить channel_id
  // НЕ делаем это автоматически, чтобы избежать ошибок
  // Используйте SQL скрипт для заполнения channel_id для целевых пользователей
};

exports.down = function(knex) {
  return knex.schema.table('users', function(table) {
    table.dropColumn('channel_id');
  });
};
