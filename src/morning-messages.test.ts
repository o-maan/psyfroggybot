import { describe, it, expect, beforeEach } from 'vitest';
import { getMorningMessageText, parseMorningMessages } from './morning-messages';
import { saveMorningMessageIndexes, getMorningMessageIndexes } from './db';

describe('Циклическая ротация утренних сообщений', () => {
  const testUserId = 999999;

  beforeEach(() => {
    // Сбрасываем индексы перед каждым тестом
    saveMorningMessageIndexes(testUserId, 0, 0, 0, false, false, false, false);
  });

  it('должен циклически выдавать будние тексты и сбрасывать индекс после последнего', () => {
    const messages = parseMorningMessages();
    const weekdayCount = messages.weekday.length;

    console.log(`📊 Всего будних текстов: ${weekdayCount}`);

    // Проходим все тексты + 5 дополнительных для проверки цикла
    for (let i = 0; i < weekdayCount + 5; i++) {
      const text = getMorningMessageText(testUserId, 2); // Вторник
      const indexes = getMorningMessageIndexes(testUserId);

      console.log(`Итерация ${i + 1}: weekday_index = ${indexes?.weekday_index}, текст получен: ${text.length > 0}`);

      // Текст должен быть всегда
      expect(text).toBeTruthy();
      expect(text.length).toBeGreaterThan(0);

      // После полного цикла индекс должен сброситься
      if (i === weekdayCount) {
        expect(indexes?.weekday_index).toBe(0);
        console.log('✅ Индекс сброшен после полного цикла');
      }
    }
  });

  it('должен циклически выдавать выходные тексты и сбрасывать индекс после последнего', () => {
    const messages = parseMorningMessages();
    const weekendCount = messages.weekend.length;

    console.log(`📊 Всего выходных текстов: ${weekendCount}`);

    // Проходим все тексты + 5 дополнительных для проверки цикла
    for (let i = 0; i < weekendCount + 5; i++) {
      const text = getMorningMessageText(testUserId, 6); // Суббота
      const indexes = getMorningMessageIndexes(testUserId);

      console.log(`Итерация ${i + 1}: weekend_index = ${indexes?.weekend_index}, текст получен: ${text.length > 0}`);

      // Текст должен быть всегда
      expect(text).toBeTruthy();
      expect(text.length).toBeGreaterThan(0);

      // После полного цикла индекс должен сброситься
      if (i === weekendCount) {
        expect(indexes?.weekend_index).toBe(0);
        console.log('✅ Индекс сброшен после полного цикла');
      }
    }
  });

  it('должен правильно обрабатывать переход на 32-й текст выходных', () => {
    const messages = parseMorningMessages();
    const weekendCount = messages.weekend.length;

    // Устанавливаем индекс на предпоследний текст
    saveMorningMessageIndexes(testUserId, 0, weekendCount - 2, 0, false, false, false, false);

    // Получаем предпоследний текст
    const text1 = getMorningMessageText(testUserId, 6);
    let indexes = getMorningMessageIndexes(testUserId);
    console.log(`Предпоследний: weekend_index = ${indexes?.weekend_index}`);
    expect(text1).toBeTruthy();
    expect(indexes?.weekend_index).toBe(weekendCount - 1);

    // Получаем последний текст
    const text2 = getMorningMessageText(testUserId, 6);
    indexes = getMorningMessageIndexes(testUserId);
    console.log(`Последний: weekend_index = ${indexes?.weekend_index}`);
    expect(text2).toBeTruthy();
    expect(indexes?.weekend_index).toBe(0); // Должен сброситься!

    // Получаем первый текст нового цикла
    const text3 = getMorningMessageText(testUserId, 6);
    indexes = getMorningMessageIndexes(testUserId);
    console.log(`Первый нового цикла: weekend_index = ${indexes?.weekend_index}`);
    expect(text3).toBeTruthy();
    expect(indexes?.weekend_index).toBe(1);

    console.log('✅ Переход через границу цикла работает корректно');
  });

  it('должен правильно обрабатывать переход на 63-й текст будних', () => {
    const messages = parseMorningMessages();
    const weekdayCount = messages.weekday.length;

    // Устанавливаем индекс на предпоследний текст
    saveMorningMessageIndexes(testUserId, weekdayCount - 2, 0, 0, false, false, false, false);

    // Получаем предпоследний текст
    const text1 = getMorningMessageText(testUserId, 2);
    let indexes = getMorningMessageIndexes(testUserId);
    console.log(`Предпоследний: weekday_index = ${indexes?.weekday_index}`);
    expect(text1).toBeTruthy();
    expect(indexes?.weekday_index).toBe(weekdayCount - 1);

    // Получаем последний текст
    const text2 = getMorningMessageText(testUserId, 2);
    indexes = getMorningMessageIndexes(testUserId);
    console.log(`Последний: weekday_index = ${indexes?.weekday_index}`);
    expect(text2).toBeTruthy();
    expect(indexes?.weekday_index).toBe(0); // Должен сброситься!

    // Получаем первый текст нового цикла
    const text3 = getMorningMessageText(testUserId, 2);
    indexes = getMorningMessageIndexes(testUserId);
    console.log(`Первый нового цикла: weekday_index = ${indexes?.weekday_index}`);
    expect(text3).toBeTruthy();
    expect(indexes?.weekday_index).toBe(1);

    console.log('✅ Переход через границу цикла работает корректно');
  });

  it('не должен выдавать undefined или пустой текст на границах', () => {
    const messages = parseMorningMessages();
    const weekendCount = messages.weekend.length;

    // Тестируем критические индексы: последний, 0, первый после сброса
    const criticalIndexes = [weekendCount - 1, 0, 1];

    for (const index of criticalIndexes) {
      saveMorningMessageIndexes(testUserId, 0, index, 0, false, false, false, false);
      const text = getMorningMessageText(testUserId, 6);

      expect(text).toBeDefined();
      expect(text).not.toBe('');
      expect(text).not.toBe('undefined');
      expect(typeof text).toBe('string');
      expect(text.length).toBeGreaterThan(0);

      console.log(`✅ Индекс ${index}: текст корректный (${text.length} символов)`);
    }
  });
});
