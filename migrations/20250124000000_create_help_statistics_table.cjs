exports.up = async function(knex) {
  // Таблица для хранения статистики использования команды /help
  await knex.schema.createTable('help_statistics', (table) => {
    table.increments('id').primary();
    table.integer('user_id').notNullable(); // ID пользователя
    table.string('anxiety_type').notNullable(); // Тип тревоги: 'acute', 'thoughts', 'background', 'people_places'
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index('user_id');
    table.index('anxiety_type');
    table.index('created_at');
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('help_statistics');
};
