/**
 * Миграция-заглушка для совместимости с состоянием БД на сервере
 * Реальная миграция add_city находится в 20251130000001_add_city_to_users.cjs
 * Этот файл нужен только для прохождения валидации Knex локально
 */

exports.up = function(knex) {
  // Ничего не делаем - миграция уже применена как 001
  return Promise.resolve();
};

exports.down = function(knex) {
  // Откат не нужен
  return Promise.resolve();
};
