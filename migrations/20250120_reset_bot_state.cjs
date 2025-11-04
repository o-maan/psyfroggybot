/**
 * Сброс состояния бота для начала с вводных постов
 * - Сбрасывает флаги morning_intro_shown и evening_intro_shown
 * - Очищает списки радости (joy_sources, joy_emotions)
 * - Очищает положительные события (positive_events)
 */

exports.up = function(knex) {
  return knex.transaction(async (trx) => {
    // Сбрасываем флаги вводных постов
    await trx.raw(`
      UPDATE morning_message_indexes
      SET morning_intro_shown = 0,
          evening_intro_shown = 0
    `);

    // Очищаем списки радости
    await trx('joy_sources').delete();
    await trx('joy_emotions').delete();

    // Очищаем положительные события
    await trx('positive_events').delete();
  });
};

exports.down = function(knex) {
  // Откатить эту миграцию невозможно, так как данные удаляются
  return Promise.resolve();
};
