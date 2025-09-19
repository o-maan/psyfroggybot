exports.up = async function (knex) {
  const exists = await knex.schema.hasTable('angry_posts');
  if (exists) {
    return;
  }
  return knex.schema.createTable('angry_posts', function (table) {
    table.increments('id').primary();

    // ID сообщения в канале
    table.integer('channel_message_id').notNullable();
    table.index('channel_message_id');

    // ID пересланного сообщения в группе обсуждений (если есть)
    table.integer('thread_id');
    table.index('thread_id');

    // ID пользователя для которого был создан злой пост
    table.integer('user_id').notNullable();
    table.index('user_id');

    // Временная метка создания
    table.timestamp('created_at').defaultTo(knex.fn.now());

    // Уникальная связь channel_message_id
    table.unique(['channel_message_id']);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable('angry_posts');
};