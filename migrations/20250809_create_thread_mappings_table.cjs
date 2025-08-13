exports.up = async function (knex) {
  const exists = await knex.schema.hasTable('thread_mappings');
  if (exists) {
    return;
  }
  return knex.schema.createTable('thread_mappings', function (table) {
    table.increments('id').primary();

    // ID сообщения в канале
    table.integer('channel_message_id').notNullable();
    table.index('channel_message_id');

    // ID пересланного сообщения в группе обсуждений (thread_id)
    table.integer('thread_id').notNullable();
    table.index('thread_id');

    // Временная метка создания
    table.timestamp('created_at').defaultTo(knex.fn.now());

    // Уникальная связь channel_message_id -> thread_id
    table.unique(['channel_message_id']);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable('thread_mappings');
};
