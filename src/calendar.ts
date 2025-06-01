import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

import { config } from 'dotenv';
config();

export class CalendarService {
  private oauth2Client: OAuth2Client;
  private calendar: any;

  constructor() {
    this.oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    this.calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });
  }

  // Получить URL для авторизации
  getAuthUrl(options?: { state?: string }): string {
    // Используем только разрешение на чтение календаря
    const scopes = ['https://www.googleapis.com/auth/calendar.readonly'];
    const params: any = {
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent',
    };
    if (options?.state) {
      params.state = options.state;
    }
    return this.oauth2Client.generateAuthUrl(params);
  }

  // Получить токен по коду авторизации
  async getToken(code: string) {
    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);
    return tokens;
  }

  // Установить токен
  setToken(tokens: any) {
    this.oauth2Client.setCredentials(tokens);
  }

  // Получить события календаря за период
  async getEvents(timeMin: string, timeMax: string) {
    try {
      const response = await this.calendar.events.list({
        calendarId: 'primary', // primary - это основной календарь пользователя
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 100 // Ограничиваем количество событий
      });

      return response.data.items;
    } catch (error) {
      console.error('Ошибка при получении событий календаря:', error);
      throw error;
    }
  }

  // Получить события на сегодня
  async getTodayEvents() {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

    return this.getEvents(
      startOfDay.toISOString(),
      endOfDay.toISOString()
    );
  }

  // Получить события на завтра
  async getTomorrowEvents() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const startOfDay = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate());
    const endOfDay = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate() + 1);

    return this.getEvents(
      startOfDay.toISOString(),
      endOfDay.toISOString()
    );
  }

  // Получить события на неделю
  async getWeekEvents() {
    const now = new Date();
    const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);

    return this.getEvents(
      startOfWeek.toISOString(),
      endOfWeek.toISOString()
    );
  }
}

/**
 * Format a list of Google Calendar events for display.
 * @param events Array of calendar events (from Google API)
 * @param options Formatting options
 * @returns Formatted string for Telegram/HTML
 */
export function formatCalendarEvents(
  events: any[],
  options?: {
    locale?: string;
    showDate?: boolean;
    showBusy?: boolean;
    showLocation?: boolean;
    showDescription?: boolean;
    showLink?: boolean;
  }
): string {
  const locale = options?.locale || "ru-RU";
  if (!events || events.length === 0) return "Нет событий.";
  return events
    .map((e) => {
      const start = e.start?.dateTime || e.start?.date;
      const end = e.end?.dateTime || e.end?.date;
      const isAllDay = !e.start?.dateTime;
      const startDate = start
        ? new Date(start).toLocaleString(locale, {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            ...(isAllDay
              ? {}
              : { hour: "2-digit", minute: "2-digit" }),
          })
        : "";
      const endDate = end
        ? new Date(end).toLocaleString(locale, {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            ...(isAllDay
              ? {}
              : { hour: "2-digit", minute: "2-digit" }),
          })
        : "";
      let line = `<b>${e.summary || "(Без названия)"}</b>`;
      if (options?.showDate !== false) {
        if (isAllDay) {
          line += `\n🗓️ Весь день: ${startDate}`;
        } else {
          line += `\n🕒 ${startDate} - ${endDate}`;
        }
      }
      if (options?.showBusy && e.transparency) {
        line += `\nСтатус: ${e.transparency === "transparent" ? "free" : "busy"}`;
      }
      if (options?.showLocation && e.location) {
        line += `\n📍 ${e.location}`;
      }
      if (options?.showDescription && e.description) {
        line += `\n📝 ${e.description}`;
      }
      if (options?.showLink && e.htmlLink) {
        line += `\n🔗 <a href=\"${e.htmlLink}\">Открыть в календаре</a>`;
      }
      return line;
    })
    .join("\n\n");
} 