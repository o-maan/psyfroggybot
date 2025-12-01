/**
 * Миграция: Исправление записей миграций в БД
 * Удаляет некорректные записи, которые были созданы при неудачных деплоях
 */

exports.up = function(knex) {
  // Удаляем дубликат записи add_city (она уже есть как 001, не нужна 002)
  return knex('knex_migrations')
    .where('name', '20251130000002_add_city_to_users.cjs')
    .del();
};

exports.down = function(knex) {
  // Откат не нужен - это техническая миграция для исправления состояния
  return Promise.resolve();
};
