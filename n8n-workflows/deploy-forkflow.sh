#!/bin/bash

# Deploy bot workflow to n8n
# This workflow uses Wait nodes with webhooks for execution

set -e

echo "🚀 Deploying bot workflow..."

# Check if container is running
if ! docker ps | grep -q psyfroggybot-n8n; then
  echo "n8n container is not running! Start it first with: bun run n8n:start"
  ./scripts/start-n8n.sh
fi

WORKFLOW_FILE="n8n-workflows/workflow.json"

if [ ! -f "$WORKFLOW_FILE" ]; then
  echo "❌ Workflow file not found: $WORKFLOW_FILE"
  exit 1
fi

# Generate workflow with injected functions
echo "🔧 Injecting functions into workflow..."
TEMP_WORKFLOW="/tmp/workflow-generated.json"
node n8n-workflows/inject-functions.js > "$TEMP_WORKFLOW"

if [ ! -f "$TEMP_WORKFLOW" ]; then
  echo "❌ Failed to generate workflow with functions"
  exit 1
fi

# Use generated workflow for deployment
WORKFLOW_FILE="$TEMP_WORKFLOW"

# Extract workflow name
WORKFLOW_NAME=$(jq -r .name "$WORKFLOW_FILE")
echo "📦 Deploying workflow: $WORKFLOW_NAME"

# Export all workflows to find existing one
echo "🔍 Checking for existing workflow..."
docker exec psyfroggybot-n8n n8n export:workflow --all --output=/tmp/all-workflows.json 2>/dev/null || true
docker cp psyfroggybot-n8n:/tmp/all-workflows.json /tmp/all-workflows.json 2>/dev/null || true

# Find existing workflow ID
EXISTING_ID=""
if [ -f "/tmp/all-workflows.json" ]; then
  EXISTING_ID=$(jq -r --arg name "$WORKFLOW_NAME" '.[] | select(.name == $name) | .id' /tmp/all-workflows.json 2>/dev/null || echo "")
fi

if [ ! -z "$EXISTING_ID" ]; then
  echo "⚠️ Found existing workflow with ID: $EXISTING_ID"

  # Deactivate old workflow
  echo "🔄 Deactivating old workflow..."
  docker exec psyfroggybot-n8n n8n update:workflow --id="$EXISTING_ID" --active=false 2>/dev/null || true

  # Remove from database
  echo "🗑️ Removing old workflow..."
  sqlite3 n8n_data/database.sqlite "DELETE FROM workflow_entity WHERE id = '$EXISTING_ID';" 2>/dev/null || true
fi

# Import new workflow
echo "📥 Importing new workflow..."
docker cp "$WORKFLOW_FILE" psyfroggybot-n8n:/tmp/workflow.json
docker exec psyfroggybot-n8n n8n import:workflow --input=/tmp/workflow.json 2>&1 | grep -v deprecation || true

# Get new workflow ID
echo "🔍 Finding new workflow ID..."
docker exec psyfroggybot-n8n n8n export:workflow --all --output=/tmp/new-workflows.json 2>/dev/null || true
docker cp psyfroggybot-n8n:/tmp/new-workflows.json /tmp/new-workflows.json 2>/dev/null || true

NEW_ID=""
if [ -f "/tmp/new-workflows.json" ]; then
  NEW_ID=$(jq -r --arg name "$WORKFLOW_NAME" '[.[] | select(.name == $name)] | sort_by(.createdAt) | last | .id' /tmp/new-workflows.json 2>/dev/null || echo "")
fi

if [ ! -z "$NEW_ID" ]; then
  echo "✅ New workflow imported with ID: $NEW_ID"

  # Activate workflow
  echo "⚡ Activating workflow..."
  docker exec psyfroggybot-n8n n8n update:workflow --id="$NEW_ID" --active=true 2>/dev/null || true

  # Force webhook reactivation by restarting n8n container
  echo "🔄 Forcing webhook reactivation..."

  # First, clear any existing webhooks for this workflow from database
  sqlite3 n8n_data/database.sqlite "DELETE FROM webhook_entity WHERE workflowId = '$NEW_ID';" 2>/dev/null || true

  # Set workflow as active in database
  sqlite3 n8n_data/database.sqlite "UPDATE workflow_entity SET active = 1, updatedAt = STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW') WHERE id = '$NEW_ID';" 2>/dev/null || true

  # Restart n8n container to force webhook re-registration
  echo "🔄 Restarting n8n container to register webhooks..."
  docker restart psyfroggybot-n8n >/dev/null 2>&1

  # Wait for n8n to be ready
  echo "⏳ Waiting for n8n to be ready..."
  for i in {1..30}; do
    if curl -s http://localhost:5678/healthz >/dev/null 2>&1; then
      echo "✅ n8n is ready!"
      break
    fi
    sleep 1
  done

  echo "✅ Webhook reactivation completed"

  # Get the actual webhook path from database
  WEBHOOK_PATH=$(sqlite3 n8n_data/database.sqlite "SELECT webhookPath FROM webhook_entity WHERE workflowId = '$NEW_ID' LIMIT 1;" 2>/dev/null || echo "")

  if [ ! -z "$WEBHOOK_PATH" ]; then
    # Keep URL encoding as is (don't decode %20 to spaces)
    WEBHOOK_URL="http://localhost:5678/webhook/$WEBHOOK_PATH"

    # DO NOT modify N8N_WEBHOOK_URL as per CLAUDE.md
    # Just show the webhook URL for reference
    echo ""
    echo "📝 Webhook URL for reference (DO NOT modify .env):"
    echo "   $WEBHOOK_URL"
    echo ""
    echo "⚠️  N8N_WEBHOOK_URL in .env should remain:"
    echo "    N8N_WEBHOOK_URL=http://localhost:5678/webhook/bot-start"
  fi

  echo ""
  echo "🎉 workflow deployed successfully!"
  echo ""
  echo "📝 Workflow Details:"
  echo "   Name: $WORKFLOW_NAME"
  echo "   ID: $NEW_ID"
  echo "   Type: with Wait webhooks"
  if [ ! -z "$WEBHOOK_PATH" ]; then
    # Show decoded version for display
    DECODED_PATH=$(echo "$WEBHOOK_PATH" | sed 's/%20/ /g')
    echo "   Webhook: http://localhost:5678/webhook/$DECODED_PATH"
    echo "   (URL encoded: $WEBHOOK_URL)"
  fi
  echo ""
  echo "🔧 Bot Configuration:"
  echo "   Start command: bun run bot/index.ts"
  echo "   API Port: 3001"
  echo "   Redis: localhost:6379"
  echo ""
  echo "🌐 Open workflow: http://localhost:5678/workflow/$NEW_ID"
  echo "🤖 Start bot: bun run bot/index.ts"
else
  echo "❌ Failed to deploy workflow!"
  exit 1
fi

# Clean up
rm -f /tmp/all-workflows.json /tmp/new-workflows.json /tmp/workflow-generated.json 2>/dev/null || true

# Open in browser
if [ -d "/Applications/Google Chrome.app" ]; then
  echo "🌐 Opening workflow in browser in 1 second..."
  sleep 1
  /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome "http://localhost:5678/workflow/$NEW_ID" 2>/dev/null &
fi
