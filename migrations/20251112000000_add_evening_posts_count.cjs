/**
 * Миграция для добавления поля evening_posts_count в таблицу users
 * Это поле используется для подсчета количества отправленных вечерних постов (не Joy)
 * чтобы определить, когда показывать Joy пост (после >= 3 постов)
 *
 * @param {import('knex')} knex
 */
exports.up = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('users', 'evening_posts_count');
  if (!hasColumn) {
    await knex.schema.table('users', (table) => {
      table.integer('evening_posts_count').defaultTo(0); // Количество отправленных вечерних постов
    });

    // Для основного пользователя (chat_id 5153477378) устанавливаем количество постов = количество дней с 4.11.2024
    const startDate = new Date('2024-11-04T00:00:00Z');
    const today = new Date();
    const daysPassed = Math.floor((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

    await knex('users')
      .where('chat_id', 5153477378)
      .update({ evening_posts_count: daysPassed });

    // Для всех остальных пользователей устанавливаем 3 (чтобы Joy пост был доступен сразу)
    await knex('users')
      .whereNot('chat_id', 5153477378)
      .update({ evening_posts_count: 3 });
  }
};

/**
 * @param {import('knex')} knex
 */
exports.down = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('users', 'evening_posts_count');
  if (hasColumn) {
    await knex.schema.table('users', (table) => {
      table.dropColumn('evening_posts_count');
    });
  }
};
