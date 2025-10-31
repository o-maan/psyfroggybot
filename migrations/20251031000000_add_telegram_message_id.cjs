exports.up = async function(knex) {
  // Добавляем колонку telegram_message_id в таблицу messages
  // для возможности обновления отредактированных сообщений
  await knex.schema.table('messages', (table) => {
    table.integer('telegram_message_id'); // ID сообщения из Telegram API
    table.integer('chat_id'); // ID чата откуда пришло сообщение

    // Индекс для быстрого поиска по chat_id + telegram_message_id
    table.index(['chat_id', 'telegram_message_id']);
  });
};

exports.down = async function(knex) {
  await knex.schema.table('messages', (table) => {
    table.dropColumn('telegram_message_id');
    table.dropColumn('chat_id');
  });
};
