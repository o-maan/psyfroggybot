/**
 * Миграция: Добавление имени основному пользователю
 */

exports.up = function(knex) {
  return knex('users')
    .where('chat_id', 5153477378)
    .update({
      name: 'Алекс'
    });
};

exports.down = function(knex) {
  return knex('users')
    .where('chat_id', 5153477378)
    .update({
      name: null
    });
};
