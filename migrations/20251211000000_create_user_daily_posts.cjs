/**
 * Миграция: Таблица для отслеживания всех ежедневных постов каждого пользователя
 *
 * Назначение:
 * - Отслеживать КАКИЕ посты (вечерние/утренние/злые) отправлены КОМУ и КОГДА
 * - Проверять ответы пользователя БЕЗ глобального last_daily_run
 * - Предотвращать дубли постов через UNIQUE constraint
 * - Обеспечить полную автономию каждого пользователя
 *
 * Решаемые проблемы:
 * 1. Дублирование постов (2 злых, 2 утренних, 2 вводных)
 * 2. Неправильная проверка ответов (злой пост несмотря на ответ)
 * 3. Зависимость пользователей друг от друга через глобальный last_daily_run
 */

exports.up = function(knex) {
  return knex.schema.createTable('user_daily_posts', (table) => {
    table.increments('id').primary();
    table.integer('user_id').notNullable();
    table.date('post_date').notNullable().comment('Дата поста в формате YYYY-MM-DD');
    table.string('post_type', 20).notNullable().comment('evening | morning | angry');
    table.integer('channel_message_id').nullable().comment('ID поста в канале (если отправлен в канал)');
    table.timestamp('sent_at').notNullable().defaultTo(knex.fn.now()).comment('Когда был отправлен пост');
    table.integer('user_responded').notNullable().defaultTo(0).comment('Ответил ли пользователь: 0 = нет, 1 = да');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    // UNIQUE constraint - предотвращает дубли постов одного типа в один день для одного пользователя
    table.unique(['user_id', 'post_date', 'post_type'], 'unique_user_post_per_day');

    // Индекс для быстрого поиска постов конкретного пользователя за конкретную дату
    table.index(['user_id', 'post_date'], 'idx_user_date');

    // Индекс для поиска по channel_message_id (связь с message_links)
    table.index('channel_message_id', 'idx_channel_message');
  });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('user_daily_posts');
};
