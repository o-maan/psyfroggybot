exports.up = async function(knex) {
  // Добавляем поля для отслеживания уточнений эмоций
  await knex.schema.alterTable('interactive_posts', (table) => {
    // Для упрощенного сценария
    table.integer('user_emotions_clarification_message_id'); // ID сообщения пользователя с уточненными негативными эмоциями
    table.integer('bot_help_message_id'); // ID сообщения бота с помощью по эмоциям
    table.integer('user_positive_emotions_clarification_message_id'); // ID сообщения пользователя с уточненными позитивными эмоциями
    table.integer('bot_positive_help_message_id'); // ID сообщения бота с помощью по позитивным эмоциям
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('interactive_posts', (table) => {
    table.dropColumn('user_emotions_clarification_message_id');
    table.dropColumn('bot_help_message_id');
    table.dropColumn('user_positive_emotions_clarification_message_id');
    table.dropColumn('bot_positive_help_message_id');
  });
};