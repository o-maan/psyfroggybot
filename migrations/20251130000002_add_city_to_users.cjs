/**
 * Миграция: Добавление поля city для хранения названия города пользователя
 *
 * Поле city хранит название города, которое ввел пользователь
 * (например, "Москва", "Нью-Йорк", "London")
 * Используется для отображения в команде /me
 */

exports.up = function(knex) {
  return knex.schema.table('users', (table) => {
    // Название города, которое ввел пользователь
    table.text('city').nullable();
  });
};

exports.down = function(knex) {
  return knex.schema.table('users', (table) => {
    table.dropColumn('city');
  });
};
