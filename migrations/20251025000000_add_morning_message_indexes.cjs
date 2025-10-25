exports.up = async function(knex) {
  // Таблица для хранения индексов текстов утренних сообщений
  await knex.schema.createTable('morning_message_indexes', (table) => {
    table.increments('id').primary();
    table.integer('user_id').notNullable().unique(); // ID пользователя
    table.integer('weekday_index').defaultTo(0); // Индекс текста для будних дней (0-61)
    table.integer('weekend_index').defaultTo(0); // Индекс текста для выходных (0-25)
    table.integer('greeting_index').defaultTo(0); // Индекс приветствия (0-9)
    table.boolean('used_mon').defaultTo(false); // Использован ли текст ПН в текущем цикле
    table.boolean('used_wed').defaultTo(false); // Использован ли текст СР в текущем цикле
    table.boolean('used_thu').defaultTo(false); // Использован ли текст ЧТ в текущем цикле
    table.boolean('used_sun').defaultTo(false); // Использован ли текст ВС в текущем цикле
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.index('user_id');
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('morning_message_indexes');
};
