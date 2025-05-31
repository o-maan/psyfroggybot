exports.up = async function(knex) {
  await knex.schema.dropTableIfExists('user_image_indexes');
  await knex.schema.createTable('user_image_indexes', (table) => {
    table.increments('id').primary();
    table.integer('chat_id').unique();
    table.integer('image_index');
    table.string('updated_at').defaultTo(knex.fn.now());
  });
};

exports.down = async function() {
//   await knex.schema.dropTableIfExists('user_image_indexes');
};
