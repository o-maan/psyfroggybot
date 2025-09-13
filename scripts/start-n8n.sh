#!/bin/bash

echo "🔍 Checking if n8n is already running..."
if docker ps | grep -q psyfroggybot-n8n; then
  echo "✅ n8n is already running!"
  echo "📝 Open http://localhost:5678"
  exit 0
fi

echo "🧹 Cleaning up stopped container if exists..."
docker rm psyfroggybot-n8n 2>/dev/null || true

# Create network if doesn't exist
docker network create psyfroggybot-network 2>/dev/null || true

echo "🚀 Starting n8n container..."
docker run -d \
  --name psyfroggybot-n8n \
  --network psyfroggybot-network \
  -p 5678:5678 \
  -v $(pwd)/n8n_data:/home/node/.n8n \
  -v $(pwd)/n8n_files:/files \
  -v $(pwd)/n8n-workflows:/workflows:ro \
  -v $(pwd)/prompts:/prompts:ro \
  -e N8N_HOST=0.0.0.0 \
  -e N8N_PORT=5678 \
  -e N8N_PROTOCOL=http \
  -e WEBHOOK_URL=http://localhost:5678/ \
  -e N8N_METRICS=true \
  -e N8N_LOG_LEVEL=info \
  -e EXECUTIONS_DATA_SAVE_ON_ERROR=all \
  -e EXECUTIONS_DATA_SAVE_ON_SUCCESS=all \
  -e EXECUTIONS_DATA_SAVE_ON_PROGRESS=true \
  -e EXECUTIONS_DATA_SAVE_MANUAL_EXECUTIONS=true \
  -e GENERIC_TIMEZONE=Europe/Moscow \
  -e N8N_ENCRYPTION_KEY=n8n-psyfroggybot-secret-key-2024 \
  -e N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=false \
  -e NODE_FUNCTION_ALLOW_BUILTIN=fs,path,crypto \
  -e NODE_FUNCTION_ALLOW_EXTERNAL=* \
  -e N8N_CUSTOM_ENV_VARS=BRAVE_SEARCH_API_KEY \
  -e DB_TYPE=sqlite \
  -e DB_SQLITE_DATABASE=/home/node/.n8n/database.sqlite \
  -e BRAVE_SEARCH_API_KEY=$(grep BRAVE_SEARCH_API_KEY .env | cut -d '=' -f2) \
  -e N8N_LOG_LEVEL=debug \
  -e N8N_LOG_OUTPUT=console \
  \
  n8nio/n8n:latest

echo "⏳ Waiting for n8n to start..."
sleep 5

# Check if n8n is running
if ! docker ps | grep -q psyfroggybot-n8n; then
  echo "❌ n8n container is not running!"
  docker logs psyfroggybot-n8n --tail 20
  exit 1
fi

# Check if database exists and is valid
if [ -f "n8n_data/database.sqlite" ]; then
  # Check if database is valid
  USER_COUNT=$(sqlite3 n8n_data/database.sqlite "SELECT COUNT(*) FROM user;" 2>/dev/null || echo "0")
  if [ "$USER_COUNT" -eq "0" ]; then
    echo "⚠️ Database seems corrupted, restoring from backup..."
    if [ -f "n8n_data/database.sqlite.good" ]; then
      cp n8n_data/database.sqlite.good n8n_data/database.sqlite
      echo "✅ Database restored from backup"
    else
      echo "❌ No good backup found. Run: ./fix-n8n.sh"
      exit 1
    fi
  else
    echo "✅ Using existing database"
  fi

  # Check if workflow exists
  WORKFLOW_ID=$(sqlite3 n8n_data/database.sqlite "SELECT id FROM workflow_entity WHERE name LIKE '%psyfroggybot Article Pipeline - Full Business Logic%' ORDER BY id DESC LIMIT 1;" 2>/dev/null || echo "")

  if [ -z "$WORKFLOW_ID" ]; then
    echo "💉 Workflow not found, importing new..."

    # Wait a bit more for n8n to fully initialize
    sleep 5

    # Check if workflow file exists
    if [ -f "n8n-workflows/n8n-workflow-full-business-logic.json" ]; then
      # Prepare workflow for import (remove tags and set active=false to avoid errors)
      echo "Preparing workflow for import..."
      cat n8n-workflows/n8n-workflow-full-business-logic.json | python3 -c "
import json
import sys
data = json.load(sys.stdin)
# Remove tags to avoid constraint errors
data['tags'] = []
data['active'] = False
print(json.dumps(data, indent=2))
" > n8n-workflows/workflow-for-cli-import.json

      # Copy prepared workflow to container
      docker cp n8n-workflows/workflow-for-cli-import.json psyfroggybot-n8n:/tmp/workflow.json

      # Import workflow (it will work even with project warnings)
      echo "Importing workflow..."
      docker exec psyfroggybot-n8n n8n import:workflow --input=/tmp/workflow.json 2>&1 | grep -v deprecation || true

      # Clean up temporary file
      rm -f n8n-workflows/workflow-for-cli-import.json

      # Verify import
      WORKFLOW_ID=$(sqlite3 n8n_data/database.sqlite "SELECT id FROM workflow_entity WHERE name LIKE '%psyfroggybot Article Pipeline - Full Business Logic%' ORDER BY id DESC LIMIT 1;" 2>/dev/null || echo "")
      if [ ! -z "$WORKFLOW_ID" ]; then
        echo "✅ Workflow successfully imported with ID: $WORKFLOW_ID"

        # Activate the workflow
        echo "🔄 Activating workflow..."
        sqlite3 n8n_data/database.sqlite "UPDATE workflow_entity SET active = 0;" 2>/dev/null || true
        sqlite3 n8n_data/database.sqlite "UPDATE workflow_entity SET active = 1 WHERE id = '$WORKFLOW_ID';" 2>/dev/null || true
        echo "✅ Workflow activated!"
      else
        echo "⚠️ Workflow import may have failed, please check n8n UI"
      fi
    else
      echo "⚠️ Workflow file not found, run 'bun run n8n:generate' first"
    fi
  else
    echo "✅ Workflow already exists with ID: $WORKFLOW_ID"

    # Ensure only this workflow is active
    echo "🔄 Ensuring workflow is active..."
    sqlite3 n8n_data/database.sqlite "UPDATE workflow_entity SET active = 0;" 2>/dev/null || true
    sqlite3 n8n_data/database.sqlite "UPDATE workflow_entity SET active = 1 WHERE id = '$WORKFLOW_ID';" 2>/dev/null || true
    echo "✅ Workflow is active"
  fi
else
  echo "📁 New database will be created on first login"
fi

echo ""
echo "🎉 n8n is ready!"
echo "📝 Open http://localhost:5678"
echo ""

# Update webhook URL in configuration files
if [ -f "./update-webhook-url.sh" ]; then
  echo "🔄 Updating webhook URL in configuration..."
  ./update-webhook-url.sh
fi

echo ""
echo "💡 To stop n8n: docker stop psyfroggybot-n8n"
echo "💡 To restart n8n: ./scripts/start-n8n.sh"
echo "💡 To see logs: docker logs psyfroggybot-n8n -f"
echo "💡 To test webhook: bun test-n8n.ts"
