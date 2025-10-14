exports.up = function(knex) {
  return knex.schema.createTable('emotions_support_texts_history', function(table) {
    table.increments('id').primary();
    table.integer('message_index').notNullable();
    table.timestamp('used_at').defaultTo(knex.fn.now());
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('emotions_support_texts_history');
};
