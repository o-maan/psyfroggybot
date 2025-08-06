exports.up = function(knex) {
  return knex.schema.createTable('message_links', function(table) {
    table.increments('id').primary();
    
    // Связь с основным постом
    table.integer('channel_message_id').notNullable();
    table.index('channel_message_id');
    
    // ID сообщения (от пользователя или бота)
    table.bigInteger('message_id').notNullable();
    table.index('message_id');
    
    // Тип сообщения: 'user', 'bot_task1', 'bot_schema', 'bot_task2', 'bot_task3', 'bot_other'
    table.string('message_type').notNullable();
    
    // ID пользователя (0 для сообщений бота)
    table.bigInteger('user_id').notNullable().defaultTo(0);
    
    // ID сообщения на которое это ответ (если есть)
    table.bigInteger('reply_to_message_id').nullable();
    
    // Thread ID если сообщение в треде
    table.bigInteger('message_thread_id').nullable();
    
    // Текст сообщения (первые 500 символов для поиска)
    table.text('message_preview').nullable();
    
    // Дополнительные данные в JSON
    table.json('metadata').nullable();
    
    // Временная метка
    table.timestamp('created_at').defaultTo(knex.fn.now());
    
    // Составной индекс для быстрого поиска
    table.index(['channel_message_id', 'message_type']);
    table.index(['user_id', 'created_at']);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('message_links');
};