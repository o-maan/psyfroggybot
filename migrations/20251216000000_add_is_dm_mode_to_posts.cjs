/**
 * Миграция для добавления колонки is_dm_mode во все таблицы постов
 *
 * is_dm_mode = 1 означает что пост отправлен в ЛС (без комментариев)
 * is_dm_mode = 0 (default) означает что пост отправлен в канал (с комментариями)
 *
 * Это позволяет handlers понимать куда отправлять ответы:
 * - is_dm_mode = 0 -> ответы идут в группу комментариев (CHAT_ID) с reply_to_message_id
 * - is_dm_mode = 1 -> ответы идут в ЛС пользователю (user_id)
 */

exports.up = async function(knex) {
  // Добавляем is_dm_mode в interactive_posts (вечерние посты)
  const hasInteractiveIsDmMode = await knex.schema.hasColumn('interactive_posts', 'is_dm_mode');
  if (!hasInteractiveIsDmMode) {
    await knex.schema.alterTable('interactive_posts', (table) => {
      table.boolean('is_dm_mode').defaultTo(false);
    });
  }

  // Добавляем is_dm_mode в morning_posts (утренние посты)
  const hasMorningIsDmMode = await knex.schema.hasColumn('morning_posts', 'is_dm_mode');
  if (!hasMorningIsDmMode) {
    await knex.schema.alterTable('morning_posts', (table) => {
      table.boolean('is_dm_mode').defaultTo(false);
    });
  }

  // Добавляем is_dm_mode в angry_posts (злые посты)
  const hasAngryIsDmMode = await knex.schema.hasColumn('angry_posts', 'is_dm_mode');
  if (!hasAngryIsDmMode) {
    await knex.schema.alterTable('angry_posts', (table) => {
      table.boolean('is_dm_mode').defaultTo(false);
    });
  }
};

exports.down = async function(knex) {
  // Удаляем is_dm_mode из interactive_posts
  const hasInteractiveIsDmMode = await knex.schema.hasColumn('interactive_posts', 'is_dm_mode');
  if (hasInteractiveIsDmMode) {
    await knex.schema.alterTable('interactive_posts', (table) => {
      table.dropColumn('is_dm_mode');
    });
  }

  // Удаляем is_dm_mode из morning_posts
  const hasMorningIsDmMode = await knex.schema.hasColumn('morning_posts', 'is_dm_mode');
  if (hasMorningIsDmMode) {
    await knex.schema.alterTable('morning_posts', (table) => {
      table.dropColumn('is_dm_mode');
    });
  }

  // Удаляем is_dm_mode из angry_posts
  const hasAngryIsDmMode = await knex.schema.hasColumn('angry_posts', 'is_dm_mode');
  if (hasAngryIsDmMode) {
    await knex.schema.alterTable('angry_posts', (table) => {
      table.dropColumn('is_dm_mode');
    });
  }
};
