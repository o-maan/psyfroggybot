import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';
import { CalendarService } from '../../calendar';
import { registerStartCommand } from './start';
import { registerSetnameCommand } from './setname';
import { registerRemindCommand } from './remind';
import { registerCalendarCommand } from './calendar';
import { registerDayCommand } from './day';
import { registerJoyCommand } from './joy';
import { registerHelpCommand } from './help';
import { registerMeCommand } from './me';
import { registerPsytasksCommand } from './psytasks';
import { registerUnpackCommand } from './unpack';
import { registerResetCommand } from './reset';

export function registerUserCommands(bot: Telegraf, scheduler: Scheduler, calendarService: CalendarService) {
  registerStartCommand(bot, scheduler);
  registerSetnameCommand(bot);
  registerRemindCommand(bot, scheduler);
  registerCalendarCommand(bot, calendarService);
  registerDayCommand(bot, scheduler);
  registerJoyCommand(bot, scheduler);
  registerHelpCommand(bot);
  registerMeCommand(bot);
  registerPsytasksCommand(bot); // 🆕 Задания от психолога
  registerUnpackCommand(bot); // 🆕 Разобрать ситуацию
  registerResetCommand(bot); // 🆕 Сброс данных ЛС
}