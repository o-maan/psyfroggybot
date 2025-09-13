import { createClient } from 'redis';

export interface WaitingSession {
  resumeUrl: string;
  chatId: string | number;
  stepName: string;
  timestamp: string;
}

export class SessionManager {
  private redis: ReturnType<typeof createClient>;
  private connected: boolean = false;

  constructor() {
    this.redis = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    });

    this.redis.on('error', (err) => {
      console.error('Redis error:', err);
      this.connected = false;
    });

    this.redis.on('connect', () => {
      console.log('✅ Connected to Redis');
      this.connected = true;
    });
  }

  async connect() {
    if (!this.connected) {
      await this.redis.connect();
    }
  }

  // Store resume URL for a chat
  async setResumeUrl(chatId: string | number, resumeUrl: string, stepName: string) {
    const session: WaitingSession = {
      resumeUrl,
      chatId,
      stepName,
      timestamp: new Date().toISOString()
    };
    
    const key = `session:${chatId}`;
    await this.redis.set(key, JSON.stringify(session), {
      EX: 3600 // Expire after 1 hour
    });
  }

  // Get resume URL for a chat
  async getSession(chatId: string | number): Promise<WaitingSession | null> {
    const key = `session:${chatId}`;
    const data = await this.redis.get(key);
    return data ? JSON.parse(data) : null;
  }

  // Clear session
  async clearSession(chatId: string | number) {
    const key = `session:${chatId}`;
    await this.redis.del(key);
  }

  // Store workflow data
  async setWorkflowData(chatId: string | number, data: any) {
    const key = `workflow:${chatId}`;
    await this.redis.set(key, JSON.stringify(data), {
      EX: 3600 // Expire after 1 hour
    });
  }

  // Get workflow data
  async getWorkflowData(chatId: string | number): Promise<any | null> {
    const key = `workflow:${chatId}`;
    const data = await this.redis.get(key);
    return data ? JSON.parse(data) : null;
  }

  // Clear workflow data
  async clearWorkflowData(chatId: string | number) {
    const key = `workflow:${chatId}`;
    await this.redis.del(key);
  }

  // List all active sessions (for debugging)
  async listActiveSessions(): Promise<WaitingSession[]> {
    const keys = await this.redis.keys('session:*');
    const sessions: WaitingSession[] = [];
    
    for (const key of keys) {
      const data = await this.redis.get(key);
      if (data) {
        sessions.push(JSON.parse(data));
      }
    }
    
    return sessions;
  }
}