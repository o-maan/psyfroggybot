# Настройка webhook для автоматической проверки после деплоя

## 1. Добавьте в .env:

```bash
PORT=3000
```

## 2. В GitHub Actions добавьте шаг после деплоя:

```yaml
- name: Trigger post-deploy check
  run: |
    curl -X POST https://your-bot-domain.com/webhook/deploy
```

## 3. Убедитесь, что webhook доступен:

Express сервер запускается на порту из переменной PORT (по умолчанию 3000).
Убедитесь, что этот порт проксируется через ваш веб-сервер (nginx/caddy).

## Endpoints:

- `POST /webhook/deploy` - запускает проверку незавершенных заданий
- `GET /health` - проверка работоспособности сервера

## Логирование:

- Все вызовы webhook логируются для отладки