exports.up = function (knex) {
  return knex.schema.alterTable('users', function (table) {
    table.string('name').nullable();
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('users', function (table) {
    table.dropColumn('name');
  });
};