/**
 * Миграция: Добавление поля onboarding_state для отслеживания состояния онбординга
 *
 * Возможные значения:
 * - null - онбординг завершен
 * - 'waiting_start' - ожидаем нажатие кнопки "Вперед"
 * - 'waiting_name' - ожидаем ввод имени
 */

exports.up = function(knex) {
  return knex.schema.table('users', (table) => {
    table.string('onboarding_state').nullable().defaultTo(null);
  });
};

exports.down = function(knex) {
  return knex.schema.table('users', (table) => {
    table.dropColumn('onboarding_state');
  });
};
