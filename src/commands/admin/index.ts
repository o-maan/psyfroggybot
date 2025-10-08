import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';

// Импортируем все административные команды
import { registerTestSchemaCommand } from './test_schema';
import { registerMinimalTestLLMCommand } from './minimalTestLLM';
import { registerTestButtonCommand } from './test_button';
import { registerChatInfoCommand } from './chat_info';
import { registerUsersCommand } from './users';
import { registerNextImageCommand } from './next_image';
import { registerFly1Command } from './fly1';
import { registerLastRunCommand } from './last_run';
import { registerAnsCommand } from './ans';
import { registerTestMorningCheckCommand } from './test_morning_check';
import { registerAngryCommand } from './angry';
import { registerCheckConfigCommand } from './check_config';
import { registerCheckAccessCommand } from './check_access';
import { registerCheckPostsCommand } from './check_posts';
import { registerStatusCommand } from './status';
import { registerTestScheduleCommand } from './test_schedule';
import { registerTestNowCommand } from './test_now';
import { registerTestReminderCommand } from './test_reminder';
import { registerTestReplyCommand } from './test_reply';
import { registerLogsCommand } from './logs';
import { registerShowLastFilterCommand } from './show_last_filter';
import { registerTestAngryCommand } from './test-angry';
import { registerTestMorningCommand } from './test_morning';

// Функция для регистрации всех административных команд
export function registerAdminCommands(bot: Telegraf, scheduler: Scheduler) {
  registerTestSchemaCommand(bot, scheduler);
  registerMinimalTestLLMCommand(bot, scheduler);
  registerTestButtonCommand(bot, scheduler);
  registerChatInfoCommand(bot, scheduler);
  registerUsersCommand(bot, scheduler);
  registerNextImageCommand(bot, scheduler);
  registerFly1Command(bot, scheduler);
  registerLastRunCommand(bot, scheduler);
  registerAnsCommand(bot, scheduler);
  registerTestMorningCheckCommand(bot, scheduler);
  registerAngryCommand(bot, scheduler);
  registerCheckConfigCommand(bot, scheduler);
  registerCheckAccessCommand(bot, scheduler);
  registerCheckPostsCommand(bot, scheduler);
  registerStatusCommand(bot, scheduler);
  registerTestScheduleCommand(bot, scheduler);
  registerTestNowCommand(bot, scheduler);
  registerTestReminderCommand(bot, scheduler);
  registerTestReplyCommand(bot, scheduler);
  registerLogsCommand(bot, scheduler);
  registerShowLastFilterCommand(bot, scheduler);
  registerTestAngryCommand(bot, scheduler);
  registerTestMorningCommand(bot, scheduler);
}