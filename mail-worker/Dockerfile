# X0 BOT'S MAIL WORKER (docs/mail.md): the mail engine copied from Xooteq Mail, tuned for any business. Node runs the TypeScript itself
# (no compile step), as an unprivileged user. Build context: mail-worker/.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production MAIL_WORKER_PORT=5300 DATA_DIR=/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server ./server
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 5300
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5300/healthz >/dev/null || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server/main.ts"]
