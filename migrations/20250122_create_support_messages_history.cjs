exports.up = function(knex) {
  return knex.schema.createTable('support_messages_history', function(table) {
    table.increments('id').primary();
    table.integer('message_index').notNullable();
    table.timestamp('used_at').defaultTo(knex.fn.now());
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('support_messages_history');
};
