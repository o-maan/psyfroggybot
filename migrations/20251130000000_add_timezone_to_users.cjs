/**
 * Миграция: Добавление полей timezone и timezone_offset для учёта часового пояса пользователя
 *
 * Поля:
 * - timezone (TEXT) - IANA timezone название (например, "Europe/Moscow", "Asia/Vladivostok")
 *   Используется для точного определения времени отправки постов
 *   По умолчанию: "Europe/Moscow" (UTC+3)
 *
 * - timezone_offset (INTEGER) - UTC offset в минутах для быстрых вычислений
 *   Например: MSK = +3 часа = 180 минут
 *   Используется для оптимизации запросов
 *   По умолчанию: 180 (MSK)
 *
 * Все посты (вечерние, утренние, JOY, angry) будут приходить по времени пользователя
 */

exports.up = function(knex) {
  return knex.schema.table('users', (table) => {
    // IANA timezone название
    table.text('timezone').notNullable().defaultTo('Europe/Moscow');

    // UTC offset в минутах (для быстрых вычислений)
    table.integer('timezone_offset').notNullable().defaultTo(180); // MSK = UTC+3 = 180 минут
  });
};

exports.down = function(knex) {
  return knex.schema.table('users', (table) => {
    table.dropColumn('timezone');
    table.dropColumn('timezone_offset');
  });
};
