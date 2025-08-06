exports.up = function(knex) {
  return knex.schema.table('interactive_posts', function(table) {
    // ID сообщений бота для отслеживания диалога
    table.integer('bot_task1_message_id').nullable(); // ID сообщения с первым заданием
    table.integer('bot_schema_message_id').nullable(); // ID сообщения со схемой разбора
    table.integer('bot_task2_message_id').nullable(); // ID сообщения со вторым заданием (плюшки)
    table.integer('bot_task3_message_id').nullable(); // ID сообщения с третьим заданием
    
    // ID ответов пользователя
    table.integer('user_task1_message_id').nullable(); // ID ответа на первое задание
    table.integer('user_schema_message_id').nullable(); // ID ответа на схему
    table.integer('user_task2_message_id').nullable(); // ID ответа на плюшки
    
    // Текущее состояние более детально
    table.string('current_state').nullable().defaultTo('waiting_task1');
    // Возможные значения:
    // waiting_task1 - ждем ответа на первое задание
    // waiting_schema - ждем ответа на схему разбора
    // waiting_task2 - ждем ответа на плюшки
    // waiting_task3 - ждем выполнения практики
    // completed - все выполнено
    
    // Время последнего взаимодействия
    table.timestamp('last_interaction_at').nullable();
  });
};

exports.down = function(knex) {
  return knex.schema.table('interactive_posts', function(table) {
    table.dropColumn('bot_task1_message_id');
    table.dropColumn('bot_schema_message_id');
    table.dropColumn('bot_task2_message_id');
    table.dropColumn('bot_task3_message_id');
    table.dropColumn('user_task1_message_id');
    table.dropColumn('user_schema_message_id');
    table.dropColumn('user_task2_message_id');
    table.dropColumn('current_state');
    table.dropColumn('last_interaction_at');
  });
};