exports.up = function(knex) {
  return knex.schema.createTable('angry_post_user_responses', function(table) {
    table.increments('id').primary();
    table.integer('thread_id').notNullable();
    table.integer('user_id').notNullable();
    table.integer('response_count').defaultTo(0);
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    // Уникальный индекс на комбинацию thread_id и user_id
    table.unique(['thread_id', 'user_id']);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('angry_post_user_responses');
};