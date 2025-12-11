import { Telegraf } from 'telegraf';
import { DeepWorkHandler } from '../deep-work-handler';
import { setUnpackState } from '../commands/user/unpack';
import { botLogger } from '../logger';

/**
 * UnpackWrapper - обертка вокруг DeepWorkHandler для команды /unpack
 * Автоматически устанавливает состояния в хранилище unpackStates
 */
export class UnpackWrapper extends DeepWorkHandler {
  private unpackUserId: number;

  constructor(bot: Telegraf, chatId: number, userId: number) {
    // Для /unpack работаем в ЛС, поэтому threadId не нужен
    super(bot, chatId, userId, undefined);
    this.unpackUserId = userId;
  }

  /**
   * Начать технику - ПЕРЕОПРЕДЕЛЯЕМ для установки состояния
   */
  async startTechnique(channelMessageId: number, techniqueType: string, userId: number, replyToMessageId?: number) {
    // Вызываем родительский метод
    await super.startTechnique(channelMessageId, techniqueType, userId, replyToMessageId);

    // Устанавливаем начальное состояние в зависимости от техники
    if (techniqueType === 'percept_filters') {
      setUnpackState(userId, 'deep_waiting_filters_start');
      botLogger.info({ userId, state: 'deep_waiting_filters_start' }, '📝 Начата техника "фильтры восприятия" в /unpack');
    } else if (techniqueType === 'schema' || techniqueType === 'abc') {
      setUnpackState(userId, 'schema_waiting_start');
      botLogger.info({ userId, state: 'schema_waiting_start' }, '📝 Начата техника "схема разбора" в /unpack');
    }
  }

  /**
   * Обработчик кнопки "Вперед" для разбора по схеме
   * ПЕРЕОПРЕДЕЛЯЕМ для установки состояния
   */
  async handleSchemaStart(channelMessageId: number, userId: number, replyToMessageId?: number) {
    await super.handleSchemaStart(channelMessageId, userId, replyToMessageId);
    setUnpackState(userId, 'schema_waiting_trigger');
    botLogger.info({ userId, state: 'schema_waiting_trigger' }, '📝 Начат вопрос про триггер в /unpack');
  }

  /**
   * Обработчик кнопки "Погнали" для фильтров
   * ПЕРЕОПРЕДЕЛЯЕМ для установки состояния
   */
  async handleFiltersStart(channelMessageId: number, userId: number, replyToMessageId?: number) {
    await super.handleFiltersStart(channelMessageId, userId, replyToMessageId);
    setUnpackState(userId, 'deep_waiting_thoughts');
    botLogger.info({ userId, state: 'deep_waiting_thoughts' }, '📝 Начат вопрос про мысли в /unpack');
  }
}
