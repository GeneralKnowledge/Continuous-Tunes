# Multi-stage build: compile the Vite React app, serve the static files with busybox httpd.
# The music engine runs entirely in the browser (@strudel/web) — no Node runtime needed in production.
# TLS, headers and public exposure are left to whatever sits in front of this container.

# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json ./
COPY public ./public
COPY src ./src

RUN npm run build

# ---- serve ----
FROM busybox:1.37 AS runtime

COPY --from=build /app/dist /www

USER nobody
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO /dev/null http://127.0.0.1:8080/ || exit 1

CMD ["httpd", "-f", "-v", "-p", "8080", "-h", "/www"]
