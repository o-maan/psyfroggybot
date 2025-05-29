/**
 * @param {import('knex')} knex
 */
exports.up = async function(knex) {
  // users
  const hasUsers = await knex.schema.hasTable('users');
  if (!hasUsers) {
    await knex.schema.createTable('users', (table) => {
      table.increments('id').primary();
      table.integer('chat_id').unique();
      table.string('username');
      table.string('last_response_time');
      table.integer('response_count').defaultTo(0);
    });
  }

  // messages
  const hasMessages = await knex.schema.hasTable('messages');
  if (!hasMessages) {
    await knex.schema.createTable('messages', (table) => {
      table.increments('id').primary();
      table.integer('user_id');
      table.text('message_text');
      table.string('sent_time');
      table.string('response_time');
      table.foreign('user_id').references('users.id');
    });
  }

  // user_tokens
  const hasTokens = await knex.schema.hasTable('user_tokens');
  if (!hasTokens) {
    await knex.schema.createTable('user_tokens', (table) => {
      table.increments('id').primary();
      table.integer('chat_id');
      table.text('token');
      table.string('created_at').defaultTo(knex.fn.now());
    });
  }

  // user_image_indexes
  const hasImageIndexes = await knex.schema.hasTable('user_image_indexes');
  if (!hasImageIndexes) {
    await knex.schema.createTable('user_image_indexes', (table) => {
      table.increments('id').primary();
      table.integer('chat_id').unique();
      table.integer('image_index');
      table.string('updated_at').defaultTo(knex.fn.now());
    });
  }
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('user_image_indexes');
  await knex.schema.dropTableIfExists('user_tokens');
  await knex.schema.dropTableIfExists('messages');
  await knex.schema.dropTableIfExists('users');
}; 