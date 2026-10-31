# syntax=docker/dockerfile:1
# The build stage runs on the build host's own architecture ($BUILDPLATFORM);
# its output is plain JavaScript, so it can be copied into an image for any
# target platform without emulating npm or tsc.
FROM --platform=$BUILDPLATFORM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runner
LABEL org.opencontainers.image.title="BotMarket" \
      org.opencontainers.image.description="Self-hosted marketplace for sharing Grok Bot bots with one-click install" \
      org.opencontainers.image.source="https://github.com/rannes/grokbot-botmarket" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
ENV NODE_ENV=production \
    BOTMARKET_DATA_DIR=/data \
    PORT=3000
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/seed ./seed
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/healthz" || exit 1
CMD ["node", "dist/index.js", "serve"]
