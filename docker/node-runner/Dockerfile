FROM node:20-alpine

# Security: run as non-root user
RUN addgroup -S sandbox && adduser -S sandbox -G sandbox -h /home/sandbox

WORKDIR /home/sandbox

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER sandbox

ENTRYPOINT ["/entrypoint.sh"]
