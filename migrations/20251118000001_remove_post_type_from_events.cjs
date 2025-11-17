/**
 * Миграция для удаления поля post_type из таблиц positive_events и negative_events
 * Все позитивные события должны быть в одной таблице независимо от источника (утро/вечер)
 * Аналогично для негативных событий
 */

exports.up = function (knex) {
  return knex.schema
    // Удаляем индекс и колонку из positive_events
    .table('positive_events', table => {
      table.dropIndex('post_type');
      table.dropColumn('post_type');
    })
    // Удаляем индекс и колонку из negative_events
    .table('negative_events', table => {
      table.dropIndex('post_type');
      table.dropColumn('post_type');
    });
};

exports.down = function (knex) {
  return knex.schema
    // Восстанавливаем колонку и индекс в positive_events
    .table('positive_events', table => {
      table.text('post_type').notNullable().defaultTo('evening');
      table.index('post_type');
    })
    // Восстанавливаем колонку и индекс в negative_events
    .table('negative_events', table => {
      table.text('post_type').notNullable().defaultTo('evening');
      table.index('post_type');
    });
};
