#!/bin/bash

set -euo pipefail

# Скрипт для настройки сервера Digital Ocean для psy_froggy_bot

echo "🚀 Настройка сервера Digital Ocean..."

# Обновление системы
sudo apt update && sudo apt upgrade -y

# Установка необходимых пакетов
sudo apt install -y curl git software-properties-common

# Установка Node.js и npm
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Установка Bun
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc

# Установка PM2 глобально
sudo npm install -y pm2 -g

# Установка Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy

# Создание директорий
sudo mkdir -p /var/www/psy_froggy_bot
sudo mkdir -p /var/www/databases/psy_froggy_bot
sudo mkdir -p /var/log/caddy
sudo mkdir -p /var/log/pm2

# Установка прав
sudo chown -R $USER:$USER /var/www/psy_froggy_bot
sudo chown -R $USER:$USER /var/www/databases/psy_froggy_bot
sudo chown -R caddy:caddy /var/log/caddy
sudo chown -R $USER:$USER /var/log/pm2

# Клонирование репозитория
cd /var/www/psy_froggy_bot
git clone https://github.com/o-maan/psy_froggy_bot.git .

# Создание .env файла (нужно будет заполнить)
cp .env.example .env || touch .env
echo "# Заполните переменные окружения:" >> .env
echo "TELEGRAM_BOT_TOKEN=" >> .env
echo "HF_TOKEN=" >> .env
echo "ADMIN_CHAT_ID=" >> .env
echo "NODE_ENV=production" >> .env

# Установка зависимостей
bun install --frozen-lockfile

# Запуск миграций
bun run knex migrate:latest --knexfile knexfile.cjs

# Копирование Caddyfile
sudo cp Caddyfile /etc/caddy/Caddyfile

# Настройка systemd для автозапуска
sudo systemctl enable caddy
sudo systemctl start caddy

# Настройка PM2 для автозапуска
pm2 start ecosystem.config.js
pm2 save
pm2 startup

echo "✅ Настройка сервера завершена!"
echo ""
echo "📝 Следующие шаги:"
echo "1. Отредактируйте /var/www/psy_froggy_bot/.env и добавьте все переменные окружения"
echo "2. Настройте DNS для домена psy_froggy_bot.com на IP сервера"
echo "3. Добавьте SSH ключи в GitHub Secrets:"
echo "   - DO_HOST: IP адрес сервера"
echo "   - DO_USERNAME: имя пользователя (обычно root)"
echo "   - DO_SSH_KEY: приватный SSH ключ"
echo "   - DO_PORT: порт SSH (обычно 22)"
echo "4. Перезапустите приложение: pm2 restart psy_froggy_bot"
echo "5. Проверьте статус: pm2 status" 
