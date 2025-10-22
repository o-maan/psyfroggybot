exports.up = async function(knex) {
  // Таблица для хранения утренних постов
  await knex.schema.createTable('morning_posts', (table) => {
    table.increments('id').primary();
    table.integer('channel_message_id').notNullable().unique(); // ID поста в канале
    table.integer('user_id').notNullable(); // ID пользователя (для кого создан пост)
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.string('current_step').defaultTo('waiting_user_message'); // Текущий шаг интеракции

    table.index('channel_message_id');
    table.index('user_id');
    table.index('created_at');
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('morning_posts');
};
