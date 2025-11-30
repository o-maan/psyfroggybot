/**
 * Миграция: Обновление timezone для основного пользователя (5153477378) на Europe/Belgrade
 */

exports.up = function(knex) {
  return knex('users')
    .where('chat_id', 5153477378)
    .update({
      timezone: 'Europe/Belgrade',
      timezone_offset: 60  // UTC+1 = 60 минут
    });
};

exports.down = function(knex) {
  return knex('users')
    .where('chat_id', 5153477378)
    .update({
      timezone: 'Europe/Moscow',
      timezone_offset: 180  // UTC+3 = 180 минут
    });
};
