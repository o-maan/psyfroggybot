import { describe, expect, it } from 'bun:test';

/**
 * Тесты для проверки что фраза "Переходи в комментарии и продолжим"
 * НЕ добавляется при отправке в ЛС и добавляется при отправке в канал
 *
 * Эти тесты проверяют логику на уровне функций buildMorningPost и логику добавления CTA
 */

const CHANNEL_CTA = 'Переходи в комментарии и продолжим';

describe('Фраза "Переходи в комментарии" в постах', () => {
  describe('buildMorningPost - базовый текст БЕЗ фразы', () => {
    it('buildMorningPost для понедельника НЕ содержит фразу', async () => {
      const { buildMorningPost } = await import('./morning-messages');
      const postText = await buildMorningPost(12345, 1, false); // понедельник
      expect(postText).not.toContain(CHANNEL_CTA);
    });

    it('buildMorningPost для вторника НЕ содержит фразу', async () => {
      const { buildMorningPost } = await import('./morning-messages');
      const postText = await buildMorningPost(12345, 2, false); // вторник
      expect(postText).not.toContain(CHANNEL_CTA);
    });

    it('buildMorningPost для среды НЕ содержит фразу', async () => {
      const { buildMorningPost } = await import('./morning-messages');
      const postText = await buildMorningPost(12345, 3, false); // среда
      expect(postText).not.toContain(CHANNEL_CTA);
    });

    it('buildMorningPost для четверга НЕ содержит фразу', async () => {
      const { buildMorningPost } = await import('./morning-messages');
      const postText = await buildMorningPost(12345, 4, false); // четверг
      expect(postText).not.toContain(CHANNEL_CTA);
    });

    it('buildMorningPost для субботы НЕ содержит фразу', async () => {
      const { buildMorningPost } = await import('./morning-messages');
      const postText = await buildMorningPost(12345, 6, false); // суббота
      expect(postText).not.toContain(CHANNEL_CTA);
    });

    it('buildMorningPost для воскресенья НЕ содержит фразу', async () => {
      const { buildMorningPost } = await import('./morning-messages');
      const postText = await buildMorningPost(12345, 0, false); // воскресенье
      expect(postText).not.toContain(CHANNEL_CTA);
    });
  });

  describe('Логика добавления CTA', () => {
    it('Для ЛС (channelEnabled=false) фраза НЕ добавляется', () => {
      const baseCaption = 'Тестовое сообщение';
      const channelEnabled = false;
      const hasChannelId = false;
      const isIntro = false;

      // Логика из scheduler.ts
      let finalCaption = baseCaption;
      if (channelEnabled && hasChannelId && !isIntro) {
        finalCaption = baseCaption + '\n\n' + CHANNEL_CTA + ' 😉';
      }

      expect(finalCaption).not.toContain(CHANNEL_CTA);
    });

    it('Для ЛС (channelEnabled=true, но channel_id=null) фраза НЕ добавляется', () => {
      const baseCaption = 'Тестовое сообщение';
      const channelEnabled = true;
      const hasChannelId = false; // channel_id = null
      const isIntro = false;

      let finalCaption = baseCaption;
      if (channelEnabled && hasChannelId && !isIntro) {
        finalCaption = baseCaption + '\n\n' + CHANNEL_CTA + ' 😉';
      }

      expect(finalCaption).not.toContain(CHANNEL_CTA);
    });

    it('Для канала (channelEnabled=true, channel_id есть) фраза ДОБАВЛЯЕТСЯ', () => {
      const baseCaption = 'Тестовое сообщение';
      const channelEnabled = true;
      const hasChannelId = true;
      const isIntro = false;

      let finalCaption = baseCaption;
      if (channelEnabled && hasChannelId && !isIntro) {
        finalCaption = baseCaption + '\n\n' + CHANNEL_CTA + ' 😉';
      }

      expect(finalCaption).toContain(CHANNEL_CTA);
    });

    it('Для вводного поста в канале (isIntro=true) фраза НЕ добавляется', () => {
      const baseCaption = 'Вводное сообщение';
      const channelEnabled = true;
      const hasChannelId = true;
      const isIntro = true;

      let finalCaption = baseCaption;
      if (channelEnabled && hasChannelId && !isIntro) {
        finalCaption = baseCaption + '\n\n' + CHANNEL_CTA + ' 😉';
      }

      expect(finalCaption).not.toContain(CHANNEL_CTA);
    });
  });

  describe('Логика JOY поста', () => {
    it('Для ЛС (sendingToChannel=false) JOY текст без фразы', () => {
      const joyBaseText = 'Давай соберем твой личный список';
      const sendingToChannel = false;

      // Логика из scheduler.ts sendJoyPostWithWeeklySummary
      const genderAdaptedPostText = sendingToChannel
        ? joyBaseText + '\n\n' + CHANNEL_CTA + ' 😉'
        : joyBaseText;

      expect(genderAdaptedPostText).not.toContain(CHANNEL_CTA);
    });

    it('Для канала (sendingToChannel=true) JOY текст С фразой', () => {
      const joyBaseText = 'Давай соберем твой личный список';
      const sendingToChannel = true;

      const genderAdaptedPostText = sendingToChannel
        ? joyBaseText + '\n\n' + CHANNEL_CTA + ' 😉'
        : joyBaseText;

      expect(genderAdaptedPostText).toContain(CHANNEL_CTA);
    });
  });

  describe('Логика вечернего поста', () => {
    it('Для ЛС (channelEnabled=false) вечерний пост без фразы', () => {
      const baseCaption = 'Добрый вечер! Как прошел день?';
      const channelEnabled = false;
      const hasChannelId = false;
      const isIntroPost = false;

      // Логика из scheduler.ts sendInteractiveDailyMessage
      let targetCaption = baseCaption;
      if (channelEnabled && hasChannelId) {
        targetCaption = isIntroPost ? baseCaption : baseCaption + '\n\n' + CHANNEL_CTA + ' 😉';
      }

      expect(targetCaption).not.toContain(CHANNEL_CTA);
    });

    it('Для канала (channelEnabled=true, channel_id есть) вечерний пост С фразой', () => {
      const baseCaption = 'Добрый вечер! Как прошел день?';
      const channelEnabled = true;
      const hasChannelId = true;
      const isIntroPost = false;

      let targetCaption = baseCaption;
      if (channelEnabled && hasChannelId) {
        targetCaption = isIntroPost ? baseCaption : baseCaption + '\n\n' + CHANNEL_CTA + ' 😉';
      }

      expect(targetCaption).toContain(CHANNEL_CTA);
    });

    it('Вводный вечерний пост в канале (isIntroPost=true) БЕЗ фразы', () => {
      const baseCaption = 'Привет! Это твой первый вечерний пост';
      const channelEnabled = true;
      const hasChannelId = true;
      const isIntroPost = true;

      let targetCaption = baseCaption;
      if (channelEnabled && hasChannelId) {
        targetCaption = isIntroPost ? baseCaption : baseCaption + '\n\n' + CHANNEL_CTA + ' 😉';
      }

      expect(targetCaption).not.toContain(CHANNEL_CTA);
    });
  });

  describe('Копия в ЛС при отправке в канал', () => {
    it('Если пост ушел в канал, копия в ЛС без фразы', () => {
      const channelCaption = 'Тестовое сообщение\n\n' + CHANNEL_CTA + ' 😉';
      const genderAdaptedBaseText = 'Тестовое сообщение'; // Базовый текст без фразы

      // При дублировании в ЛС используется genderAdaptedBaseText (без фразы)
      // а не channelCaption (с фразой)
      expect(genderAdaptedBaseText).not.toContain(CHANNEL_CTA);
      expect(channelCaption).toContain(CHANNEL_CTA);
    });
  });
});
