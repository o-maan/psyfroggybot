exports.up = async function(knex) {
  // Добавляем колонку для хранения индекса вечерних сообщений
  await knex.schema.table('morning_message_indexes', (table) => {
    table.integer('evening_index').defaultTo(0); // Индекс текста для вечерних сообщений (0-79)
  });
};

exports.down = async function(knex) {
  await knex.schema.table('morning_message_indexes', (table) => {
    table.dropColumn('evening_index');
  });
};
