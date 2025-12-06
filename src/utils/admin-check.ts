/**
 * Проверка является ли пользователь администратором
 * Проверяет ADMIN_CHAT_ID и MAIN_USER_ID (для Алекса и Ольги)
 */
export function isAdmin(userId: number): boolean {
  const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);
  const mainUserId = Number(process.env.MAIN_USER_ID || process.env.USER_ID || 0);

  return userId === adminChatId || userId === mainUserId;
}

/**
 * Получить ID администратора из env
 */
export function getAdminId(): number {
  return Number(process.env.ADMIN_CHAT_ID || 0);
}
