/**
 * @param {import('knex').Knex} knex
 */
exports.up = function(knex) {
  return Promise.all([
    knex.schema.table('messages', function(table) {
      table.index('user_id', 'idx_messages_user_id');
    }),
    knex.schema.table('user_tokens', function(table) {
      table.unique('chat_id', 'idx_user_tokens_chat_id');
    })
  ]);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = function(knex) {
  return Promise.all([
    knex.schema.table('messages', function(table) {
      table.dropIndex('user_id', 'idx_messages_user_id');
    }),
    knex.schema.table('user_tokens', function(table) {
      table.dropUnique('chat_id', 'idx_user_tokens_chat_id');
    })
  ]);
};
