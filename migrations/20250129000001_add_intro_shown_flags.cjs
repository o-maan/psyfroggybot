exports.up = async function(knex) {
  // Добавляем флаги для отслеживания показа вводных сообщений
  await knex.schema.table('morning_message_indexes', (table) => {
    table.boolean('morning_intro_shown').defaultTo(false); // Показано ли вводное сообщение для утренней лягушки
    table.boolean('evening_intro_shown').defaultTo(false); // Показано ли вводное сообщение для вечерней лягушки
  });
};

exports.down = async function(knex) {
  await knex.schema.table('morning_message_indexes', (table) => {
    table.dropColumn('morning_intro_shown');
    table.dropColumn('evening_intro_shown');
  });
};
