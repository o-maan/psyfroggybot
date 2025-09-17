вщслукFROM n8nio/n8n:latest

# Install sqlite3 for checking workflow existence
USER root
RUN apk add --no-cache sqlite

# Create startup script
RUN echo '#!/bin/sh' > /startup.sh && \
    echo 'set -e' >> /startup.sh && \
    echo '' >> /startup.sh && \
    echo '# Start n8n in background' >> /startup.sh && \
    echo 'n8n start &' >> /startup.sh && \
    echo 'N8N_PID=$!' >> /startup.sh && \
    echo '' >> /startup.sh && \
    echo '# Wait for n8n to be ready' >> /startup.sh && \
    echo 'sleep 10' >> /startup.sh && \
    echo '' >> /startup.sh && \
    echo '# Keep n8n running' >> /startup.sh && \
    echo 'wait $N8N_PID' >> /startup.sh && \
    chmod +x /startup.sh

USER node

# Use our startup script
CMD ["/startup.sh"]
