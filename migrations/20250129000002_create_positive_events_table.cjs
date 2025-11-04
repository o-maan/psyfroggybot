/**
 * Миграция для создания таблицы positive_events и joy_list_checkpoints
 * Эта таблица хранит позитивные события с эмоциями для функции "Список радости"
 */

exports.up = function (knex) {
  return knex.schema
    .createTable('positive_events', table => {
      table.increments('id').primary();
      table.integer('user_id').notNullable();
      table.text('event_text').notNullable(); // Текст события
      table.text('emotions_text'); // Текст эмоций (может быть пустым)
      table.text('created_at').notNullable(); // ISO timestamp
      table.text('post_type').notNullable(); // 'morning' или 'evening'
      table.text('cycle_identifier'); // ID цикла (channel_message_id)

      table.foreign('user_id').references('users.id');
      table.index('user_id');
      table.index('created_at');
      table.index('post_type');
    })
    .createTable('joy_list_checkpoints', table => {
      table.increments('id').primary();
      table.integer('user_id').notNullable().unique();
      table.text('checkpoint_time').notNullable(); // ISO timestamp последнего изменения списка радости

      table.foreign('user_id').references('users.id');
    });
};

exports.down = function (knex) {
  return knex.schema
    .dropTableIfExists('joy_list_checkpoints')
    .dropTableIfExists('positive_events');
};
