#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { functionMap } = require('./functionMap');

// Load workflow template
const workflowPath = path.join(__dirname, 'bot-workflow.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

// Inject functions into code nodes
workflow.nodes.forEach(node => {
  if (node.type === 'n8n-nodes-base.code' && functionMap[node.name]) {
    const functionPath = path.join(__dirname, 'functions', functionMap[node.name]);

    if (fs.existsSync(functionPath)) {
      // Read function content
      let functionContent = fs.readFileSync(functionPath, 'utf8');

      // Extract function body (remove module.exports wrapper)
      // Use non-greedy match to properly capture function body without the closing brace
      const match = functionContent.match(
        /module\.exports\s*=\s*function\s*\w*\s*\([^)]*\)\s*{\s*([\s\S]*?)\s*};?\s*$/
      );
      if (match) {
        // Get the function body (already properly extracted by regex)
        let body = match[1];

        // Clean up the body
        body = body.trim();

        // Set the jsCode parameter
        if (node.parameters) {
          node.parameters.jsCode = body;
        }
      }
    }
  }
});

// Output the modified workflow to stdout
console.log(JSON.stringify(workflow, null, 2));
