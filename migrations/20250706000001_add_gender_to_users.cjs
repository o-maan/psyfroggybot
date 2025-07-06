exports.up = function (knex) {
  return knex.schema.alterTable('users', function (table) {
    table.string('gender', 10).nullable(); // 'male', 'female', null
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('users', function (table) {
    table.dropColumn('gender');
  });
};