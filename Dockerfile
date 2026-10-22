# syntax=docker/dockerfile:1
# Build: docker build -t aliran .
# Run:   docker run -p 3000:3000 -v aliran-data:/data --env-file .env aliran

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY scripts ./scripts
COPY src ./src
RUN node scripts/build.js

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data
WORKDIR /app
COPY --from=build --chown=root:root /app/node_modules ./node_modules
COPY --from=build --chown=root:root /app/public ./public
COPY --chown=root:root package.json ./
COPY --chown=root:root server ./server
COPY --chown=root:root scripts ./scripts
# Code is owned by root and read-only to the app; only /data is writable, by the unprivileged node user.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/server.js"]
