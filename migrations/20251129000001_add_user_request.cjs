/**
 * Миграция: Добавление поля user_request для хранения запроса/целей пользователя
 *
 * Поле хранит текстовое описание того, что беспокоит пользователя,
 * что он хочет улучшить, к чему прийти. Используется для персонализации промптов LLM.
 *
 * Значения:
 * - null - пользователь пропустил этап или еще не прошел онбординг
 * - string - текстовое описание запроса пользователя
 */

exports.up = function(knex) {
  return knex.schema.table('users', (table) => {
    table.text('user_request').nullable().defaultTo(null);
  });
};

exports.down = function(knex) {
  return knex.schema.table('users', (table) => {
    table.dropColumn('user_request');
  });
};
