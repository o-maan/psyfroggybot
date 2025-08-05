# Настройка webhook для автоматической проверки после деплоя

## 1. Добавьте в .env:

```bash
PORT=3000
DEPLOY_WEBHOOK_SECRET=your-very-secret-key-here
```

## 2. В GitHub Actions добавьте шаг после деплоя:

```yaml
- name: Trigger post-deploy check
  run: |
    curl -X POST https://your-bot-domain.com/webhook/deploy \
      -H "Content-Type: application/json" \
      -d '{"secret": "${{ secrets.DEPLOY_WEBHOOK_SECRET }}"}'
```

## 3. Добавьте секрет в GitHub:

1. Откройте Settings → Secrets and variables → Actions
2. Нажмите "New repository secret"
3. Name: `DEPLOY_WEBHOOK_SECRET`
4. Value: тот же секрет, что в .env

Важно: Убедитесь, что на сервере в .env установлен такой же DEPLOY_WEBHOOK_SECRET!

## 4. Убедитесь, что webhook доступен:

Express сервер запускается на порту из переменной PORT (по умолчанию 3000).
Убедитесь, что этот порт проксируется через ваш веб-сервер (nginx/caddy).

## Endpoints:

- `POST /webhook/deploy` - запускает проверку незавершенных заданий
- `GET /health` - проверка работоспособности сервера

## Безопасность:

- Webhook защищен секретным ключом
- Неверный ключ возвращает 401 Unauthorized
- Все вызовы логируются