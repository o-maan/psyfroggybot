exports.up = async function(knex) {
  // Проверяем, есть ли уже уникальный индекс по chat_id
  const indexes = await knex.raw("PRAGMA index_list('user_image_indexes')");
  const hasUnique = indexes && indexes.length && indexes.some(idx => idx.unique && idx.name.includes('chat_id'));
  if (!hasUnique) {
    await knex.schema.alterTable('user_image_indexes', (table) => {
      table.unique('chat_id');
    });
  }
};

exports.down = async function(knex) {
  await knex.schema.alterTable('user_image_indexes', (table) => {
    table.dropUnique('chat_id');
  });
};
