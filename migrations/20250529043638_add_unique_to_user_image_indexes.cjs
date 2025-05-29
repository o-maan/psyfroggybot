/**
 * @param {import('knex')} knex
 */
exports.up = async function(knex) {
  const exists = await knex.schema.hasTable('user_image_indexes');
  if (!exists) {
    // Таблицы нет — миграцию пропускаем успешно
    return;
  }
  // Если таблица есть — создаём уникальный индекс
  await knex.schema.alterTable('user_image_indexes', (table) => {
    table.unique(['chat_id']);
  });
};

exports.down = async function(knex) {
  const exists = await knex.schema.hasTable('user_image_indexes');
  if (!exists) {
    // Таблицы нет — откатывать нечего
    return;
  }
  // Если таблица есть — удаляем уникальный индекс
  await knex.schema.alterTable('user_image_indexes', (table) => {
    table.dropUnique(['chat_id']);
  });
};
