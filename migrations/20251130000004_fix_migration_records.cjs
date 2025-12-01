/**
 * Миграция: Исправление записей миграций в БД
 * Удаляет некорректные записи, которые были созданы при неудачных деплоях
 */

exports.up = function(knex) {
  // Удаляем некорректные записи миграций из предыдущих попыток деплоя
  return knex('knex_migrations')
    .whereIn('name', [
      '20251130000001_update_user_timezone_to_belgrade.cjs',
      '20251130000001_add_city_to_users.cjs',
      '20251201000001_update_user_timezone_to_belgrade.cjs',
      '20251201000002_add_name_to_main_user.cjs'
    ])
    .del();
};

exports.down = function(knex) {
  // Откат не нужен - это техническая миграция для исправления состояния
  return Promise.resolve();
};
