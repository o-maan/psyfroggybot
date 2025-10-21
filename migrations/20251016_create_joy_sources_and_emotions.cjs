/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema
    .createTable("joy_sources", (table) => {
      table.increments("id").primary();
      table.integer("chat_id").notNullable();
      table.text("text").notNullable();
      table.text("source_type").notNullable(); // 'manual' | 'auto'
      table.text("created_at").notNullable();
      table
        .foreign("chat_id")
        .references("chat_id")
        .inTable("users")
        .onDelete("CASCADE");
      table.index("chat_id");
    })
    .createTable("joy_emotions", (table) => {
      table.increments("id").primary();
      table.integer("chat_id").notNullable();
      table.text("text").notNullable();
      table.text("emotion_type").notNullable(); // 'joy' | 'love'
      table.text("source_context").notNullable(); // 'morning_post' | 'main_post' | 'plushki'
      table.text("created_at").notNullable();
      table
        .foreign("chat_id")
        .references("chat_id")
        .inTable("users")
        .onDelete("CASCADE");
      table.index("chat_id");
      table.index("created_at");
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTable("joy_emotions").dropTable("joy_sources");
};
