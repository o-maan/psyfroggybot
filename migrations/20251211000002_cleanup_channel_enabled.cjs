/**
 * Миграция: Очистка channel_enabled и заполнение channel_id для Алекса
 *
 * ПРОБЛЕМА:
 * После добавления поля channel_id все пользователи имеют channel_enabled=1 (из старой миграции)
 * Это приводит к тому, что посты других пользователей попадают в канал Алекса
 *
 * РЕШЕНИЕ:
 * 1. Отключаем channel_enabled у всех пользователей кроме Алекса (5153477378)
 * 2. Заполняем channel_id только для Алекса
 *
 * РЕЗУЛЬТАТ:
 * - Алекс: dm_enabled=1, channel_enabled=1, channel_id=-1002405993986
 * - Все остальные: dm_enabled=1, channel_enabled=0, channel_id=NULL
 */

exports.up = async function(knex) {
  // 1. Отключаем channel_enabled у всех пользователей кроме Алекса
  await knex('users')
    .where('chat_id', '>', 0)
    .andWhere('chat_id', '!=', 5153477378)
    .update({ channel_enabled: 0 });

  // 2. Заполняем channel_id для Алекса (основной бот)
  // ID канала Алекса: -1002405993986
  await knex('users')
    .where('chat_id', 5153477378)
    .update({ channel_id: -1002405993986 });
};

exports.down = function(knex) {
  // Откат: восстанавливаем channel_enabled=1 для всех и очищаем channel_id
  return knex('users')
    .where('chat_id', '>', 0)
    .update({
      channel_enabled: 1,
      channel_id: null
    });
};
