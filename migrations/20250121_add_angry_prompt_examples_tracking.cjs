exports.up = function(knex) {
  return knex.schema.createTable('angry_prompt_examples_history', function(table) {
    table.increments('id').primary();
    table.integer('prompt_number').notNullable(); // 1, 2 или 3
    table.integer('example_index').notNullable();
    table.text('example_text'); // Для отладки
    table.timestamp('used_at').defaultTo(knex.fn.now());
    
    // Индекс для быстрого поиска
    table.index(['prompt_number', 'used_at']);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('angry_prompt_examples_history');
};