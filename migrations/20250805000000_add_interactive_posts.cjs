exports.up = async function(knex) {
  // Таблица для хранения интерактивных постов
  await knex.schema.createTable('interactive_posts', (table) => {
    table.increments('id').primary();
    table.integer('channel_message_id').notNullable().unique(); // ID поста в канале
    table.integer('user_id').notNullable(); // ID пользователя (для кого создан пост)
    table.json('message_data'); // Данные сгенерированного сообщения (json)
    table.string('relaxation_type'); // Тип релаксации (body/breathing)
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.boolean('task1_completed').defaultTo(false); // Выгрузка неприятных переживаний
    table.boolean('task2_completed').defaultTo(false); // Плюшки
    table.boolean('task3_completed').defaultTo(false); // Практика
    table.boolean('trophy_set').defaultTo(false); // Установлен ли трофей
    
    table.index('channel_message_id');
    table.index('user_id');
    table.index('created_at');
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('interactive_posts');
};