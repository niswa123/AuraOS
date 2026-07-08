FROM python:3.12-slim

# Security: run as non-root user
RUN groupadd -r sandbox && useradd -r -g sandbox -d /home/sandbox -s /bin/bash sandbox
RUN mkdir -p /home/sandbox && chown sandbox:sandbox /home/sandbox

# Remove unnecessary system tools to reduce attack surface
RUN apt-get update && apt-get remove -y --allow-remove-essential wget curl && \
    apt-get autoremove -y && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /home/sandbox

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER sandbox

ENTRYPOINT ["/entrypoint.sh"]
