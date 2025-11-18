/**
 * Миграция для добавления полей отслеживания состояния и обработки в message_links
 *
 * state_at_time - состояние интерактивного поста в момент получения сообщения
 *                 (waiting_negative, waiting_positive, waiting_practice, etc.)
 *
 * processed_at - timestamp когда сообщение было обработано LLM и занесено в события
 *                NULL означает что сообщение еще не обработано
 */

exports.up = function (knex) {
  return knex.schema.table('message_links', table => {
    // Состояние поста в момент отправки сообщения
    table.text('state_at_time').nullable();

    // Время обработки сообщения LLM (NULL = не обработано)
    table.timestamp('processed_at').nullable();

    // Индекс для быстрого поиска необработанных сообщений
    table.index(['processed_at', 'created_at']);
  });
};

exports.down = function (knex) {
  return knex.schema.table('message_links', table => {
    table.dropIndex(['processed_at', 'created_at']);
    table.dropColumn('state_at_time');
    table.dropColumn('processed_at');
  });
};
