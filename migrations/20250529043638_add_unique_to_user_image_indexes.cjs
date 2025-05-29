exports.up = function(knex) {
  return knex.schema.table('user_image_indexes', function(table) {
    table.unique(['chat_id']);
  });
};

exports.down = function(knex) {
  return knex.schema.table('user_image_indexes', function(table) {
    table.dropUnique(['chat_id']);
  });
};
