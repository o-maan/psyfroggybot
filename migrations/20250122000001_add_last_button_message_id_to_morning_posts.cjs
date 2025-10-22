exports.up = async function(knex) {
  await knex.schema.table('morning_posts', (table) => {
    table.integer('last_button_message_id'); // ID последнего сообщения с кнопкой "Ответь мне"
  });
};

exports.down = async function(knex) {
  await knex.schema.table('morning_posts', (table) => {
    table.dropColumn('last_button_message_id');
  });
};
