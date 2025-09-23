import { botLogger } from '../logger';

/**
 * Исправляет альтернативные названия ключей JSON от моделей LLM
 * которые могут писать ключи слитно вместо snake_case
 */
export function fixAlternativeJsonKeys(json: any, context?: { chatId?: number; source?: string }): any {
  if (!json || typeof json !== 'object') {
    return json;
  }

  // Основные ключи для обычного режима
  if (json.negativepart !== undefined && json.negative_part === undefined) {
    json.negative_part = json.negativepart;
    delete json.negativepart;
    if (context) {
      botLogger.debug({ ...context }, '🔧 Исправлен ключ: negativepart -> negative_part');
    }
  }

  if (json.positivepart !== undefined && json.positive_part === undefined) {
    json.positive_part = json.positivepart;
    delete json.positivepart;
    if (context) {
      botLogger.debug({ ...context }, '🔧 Исправлен ключ: positivepart -> positive_part');
    }
  }

  if ((json.feelsandemotions || json.feels_and_emotions_) && !json.feels_and_emotions) {
    json.feels_and_emotions = json.feelsandemotions || json.feels_and_emotions_;
    delete json.feelsandemotions;
    delete json.feels_and_emotions_;
    if (context) {
      botLogger.debug({ ...context }, '🔧 Исправлен ключ: feelsandemotions -> feels_and_emotions');
    }
  }

  if (json.deepsupport !== undefined && json.deep_support === undefined) {
    json.deep_support = json.deepsupport;
    delete json.deepsupport;
    if (context) {
      botLogger.debug({ ...context }, '🔧 Исправлен ключ: deepsupport -> deep_support');
    }
  }

  // Ключи для detectUserBusy
  if (json.probablybusy !== undefined && json.probably_busy === undefined) {
    json.probably_busy = json.probablybusy;
    delete json.probablybusy;
    if (context) {
      botLogger.debug({ ...context }, '🔧 Исправлен ключ: probablybusy -> probably_busy');
    }
  }

  if (json.busyreason !== undefined && json.busy_reason === undefined) {
    json.busy_reason = json.busyreason;
    delete json.busyreason;
    if (context) {
      botLogger.debug({ ...context }, '🔧 Исправлен ключ: busyreason -> busy_reason');
    }
  }

  // Ключи для анализа ситуаций
  if (json.situationscount !== undefined && json.situations_count === undefined) {
    json.situations_count = json.situationscount;
    delete json.situationscount;
    if (context) {
      botLogger.debug({ ...context }, '🔧 Исправлен ключ: situationscount -> situations_count');
    }
  }

  if (json.recommendedtechnique && !json.recommended_technique) {
    json.recommended_technique = json.recommendedtechnique;
    delete json.recommendedtechnique;
    if (context) {
      botLogger.debug({ ...context }, '🔧 Исправлен ключ: recommendedtechnique -> recommended_technique');
    }
  }

  // Исправляем has_cognitive_distortions внутри situations
  if (json.situations && Array.isArray(json.situations)) {
    json.situations.forEach((sit: any) => {
      if (sit.hascognitivedistortions !== undefined && sit.has_cognitive_distortions === undefined) {
        sit.has_cognitive_distortions = sit.hascognitivedistortions;
        delete sit.hascognitivedistortions;
        if (context) {
          botLogger.debug({ ...context }, '🔧 Исправлен ключ: hascognitivedistortions -> has_cognitive_distortions');
        }
      }
    });
  }

  // Исправляем значение type в recommended_technique
  if (json.recommended_technique && json.recommended_technique.type) {
    if (json.recommended_technique.type === 'perceptfilters') {
      json.recommended_technique.type = 'percept_filters';
      if (context) {
        botLogger.debug({ ...context }, '🔧 Исправлено значение type: perceptfilters -> percept_filters');
      }
    }
  }

  // Исправляем additional_text внутри вложенных объектов
  const fixAdditionalText = (obj: any) => {
    if (obj && typeof obj === 'object') {
      if (obj.additionaltext !== undefined && obj.additional_text === undefined) {
        obj.additional_text = obj.additionaltext;
        delete obj.additionaltext;
        if (context) {
          botLogger.debug({ ...context }, '🔧 Исправлен ключ: additionaltext -> additional_text');
        }
      }
    }
  };

  // Проверяем все части на наличие additional_text
  if (json.negative_part) fixAdditionalText(json.negative_part);
  if (json.positive_part) fixAdditionalText(json.positive_part);
  if (json.feels_and_emotions) fixAdditionalText(json.feels_and_emotions);

  // Для flight режима
  if (json.flight) {
    if (json.flight.additionaltask !== undefined && json.flight.additional_task === undefined) {
      json.flight.additional_task = json.flight.additionaltask;
      delete json.flight.additionaltask;
      if (context) {
        botLogger.debug({ ...context }, '🔧 Исправлен ключ: additionaltask -> additional_task (flight)');
      }
    }
  }

  return json;
}