/**
 * Миграция для добавления поля first_evening_post_date
 * Используется для проверки "прошло ли 2 дня с первого вечернего поста"
 * для показа Joy логики в воскресенье
 */

exports.up = function (knex) {
  return knex.schema.table('users', table => {
    table.text('first_evening_post_date'); // ISO timestamp первого вечернего поста
  });
};

exports.down = function (knex) {
  return knex.schema.table('users', table => {
    table.dropColumn('first_evening_post_date');
  });
};
