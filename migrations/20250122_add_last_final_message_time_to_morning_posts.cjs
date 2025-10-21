exports.up = async function(knex) {
  await knex.schema.table('morning_posts', (table) => {
    table.timestamp('last_final_message_time'); // Время последнего финального сообщения (для определения начала нового цикла)
  });
};

exports.down = async function(knex) {
  await knex.schema.table('morning_posts', (table) => {
    table.dropColumn('last_final_message_time');
  });
};
