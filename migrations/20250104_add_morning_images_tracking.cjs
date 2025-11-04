exports.up = function(knex) {
  return knex.schema
    .createTable('morning_image_category', function(table) {
      table.increments('id').primary();
      table.integer('current_category').notNullable().defaultTo(1); // Текущая категория (1, 2 или 3)
      table.timestamp('updated_at').defaultTo(knex.fn.now());
    })
    .createTable('morning_images_history', function(table) {
      table.increments('id').primary();
      table.integer('category').notNullable(); // Категория картинки (1, 2 или 3)
      table.integer('image_index').notNullable(); // Индекс картинки внутри категории
      table.timestamp('used_at').defaultTo(knex.fn.now());
    })
    .then(() => {
      // Инициализируем начальное значение категории
      return knex('morning_image_category').insert({ current_category: 1 });
    });
};

exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('morning_images_history')
    .dropTableIfExists('morning_image_category');
};
