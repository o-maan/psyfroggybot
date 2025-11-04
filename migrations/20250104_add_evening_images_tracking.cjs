exports.up = function(knex) {
  return knex.schema.createTable('evening_images_history', function(table) {
    table.increments('id').primary();
    table.integer('image_index').notNullable();
    table.timestamp('used_at').defaultTo(knex.fn.now());
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('evening_images_history');
};
