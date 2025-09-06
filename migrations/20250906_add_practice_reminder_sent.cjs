exports.up = async (knex) => {
  // Добавляем колонку для отслеживания отправки напоминания о практике
  await knex.schema.alterTable('interactive_posts', (table) => {
    table.boolean('practice_reminder_sent').defaultTo(0);
  });
  
  console.log('✅ Добавлена колонка practice_reminder_sent в таблицу interactive_posts');
};

exports.down = async (knex) => {
  await knex.schema.alterTable('interactive_posts', (table) => {
    table.dropColumn('practice_reminder_sent');
  });
};