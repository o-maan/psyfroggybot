exports.up = function(knex) {
  return knex.schema.createTable('angry_post_examples_history', function(table) {
    table.increments('id').primary();
    table.integer('example_index').notNullable();
    table.timestamp('used_at').defaultTo(knex.fn.now());
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('angry_post_examples_history');
};