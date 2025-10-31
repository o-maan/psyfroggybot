/**
 * Миграция для добавления поля joy_main_index в таблицу morning_message_indexes
 * Поле используется для циклической ротации постов основного сценария Joy
 */

exports.up = function (knex) {
  return knex.schema.table('morning_message_indexes', table => {
    table.integer('joy_main_index').defaultTo(0);
  });
};

exports.down = function (knex) {
  return knex.schema.table('morning_message_indexes', table => {
    table.dropColumn('joy_main_index');
  });
};
