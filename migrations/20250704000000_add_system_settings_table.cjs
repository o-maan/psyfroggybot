// Миграция для создания таблицы system_settings
// Используется для хранения системных настроек, включая время последней рассылки

exports.up = function(knex) {
  return knex.schema.createTable('system_settings', function(table) {
    table.string('key').primary();
    table.text('value');
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    // Индекс для быстрого поиска по ключу (уже есть через primary key)
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('system_settings');
};