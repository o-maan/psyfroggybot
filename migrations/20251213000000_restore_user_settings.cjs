/**
 * Миграция: Восстановление настроек доставки для Алекса и Оли
 *
 * ПРОБЛЕМА:
 * После миграции 20251206_add_dm_and_channel_enabled настройки сбросились на 0
 *
 * РЕШЕНИЕ:
 * Восстанавливаем правильные настройки для главных пользователей
 */

exports.up = async function(knex) {
  // 1. Восстанавливаем настройки для Алекса (основной бот, ID: 5153477378)
  await knex('users')
    .where('chat_id', 5153477378)
    .update({
      dm_enabled: 1,
      channel_enabled: 1,
      channel_id: -1002405993986
    });

  // 2. Восстанавливаем настройки для Оли (тестовый бот, ID: 476561547)
  await knex('users')
    .where('chat_id', 476561547)
    .update({
      dm_enabled: 1,
      channel_enabled: 1,
      channel_id: -1002846400650
    });

  // 3. Для ВСЕХ остальных пользователей: включаем только ЛС (отключаем канал)
  await knex('users')
    .where('chat_id', '>', 0)
    .whereNotIn('chat_id', [5153477378, 476561547])
    .update({
      dm_enabled: 1,
      channel_enabled: 0,
      channel_id: null
    });
};

exports.down = function(knex) {
  // Откат: сбрасываем все обратно
  return knex('users')
    .where('chat_id', '>', 0)
    .update({
      dm_enabled: 0,
      channel_enabled: 0,
      channel_id: null
    });
};
