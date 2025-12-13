/**
 * Добавление полей для управления режимами работы бота:
 * - dm_enabled: работа бота в личных сообщениях (ЛС)
 * - channel_enabled: работа бота через канал (только для главных пользователей)
 *
 * Это позволяет:
 * - Алексу и Ольге использовать ОБА режима одновременно
 * - Остальным пользователям работать только через ЛС
 */

exports.up = async function(knex) {
  // 1. Добавляем колонки
  await knex.schema.table('users', function(table) {
    // Добавляем поле для режима личных сообщений
    table.boolean('dm_enabled').defaultTo(true).comment('Включен ли режим работы в ЛС');

    // Добавляем поле для режима канала (только для главных пользователей)
    table.boolean('channel_enabled').defaultTo(false).comment('Включен ли режим работы через канал');
  });

  // 2. Для ВСЕХ существующих пользователей включаем ОБЛЗ режима (ЛС + канал)
  // (чтобы не сломать текущую работу бота)
  await knex('users').update({ dm_enabled: true, channel_enabled: true });
};

exports.down = function(knex) {
  return knex.schema.table('users', function(table) {
    table.dropColumn('dm_enabled');
    table.dropColumn('channel_enabled');
  });
};
