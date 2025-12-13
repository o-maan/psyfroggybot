/**
 * Миграция: Отключение всех уведомлений для Лены (716928723)
 *
 * ПРИЧИНА:
 * Бот находится в стадии тестирования.
 * Нужно временно отключить ВСЕ уведомления для Лены.
 *
 * РЕШЕНИЕ:
 * dm_enabled=0, channel_enabled=0
 * Бот будет пропускать отправку постов этому пользователю.
 */

exports.up = async function(knex) {
  // Отключаем ВСЕ уведомления для Лены
  await knex('users')
    .where('chat_id', 716928723)
    .update({
      dm_enabled: 0,
      channel_enabled: 0,
      channel_id: null
    });
};

exports.down = function(knex) {
  // Откат: восстанавливаем ЛС
  return knex('users')
    .where('chat_id', 716928723)
    .update({
      dm_enabled: 1,
      channel_enabled: 0,
      channel_id: null
    });
};
