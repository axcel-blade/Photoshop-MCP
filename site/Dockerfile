# syntax=docker/dockerfile:1
# Docs site (Astro -> static files -> nginx). Build from the REPOSITORY ROOT: the site renders
# ../docs/*.md, reads ../package.json and serves ../installers.
#   docker build -f site/Dockerfile -t photoshop-mcp-site .
#   docker compose -f site/docker-compose.yml up --build      -> http://localhost:8080/

# --- build ---
FROM node:22-alpine AS build
WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@10.18.0 --activate

COPY site/package.json site/pnpm-lock.yaml site/
RUN pnpm --dir site install --frozen-lockfile

COPY package.json ./
COPY docs ./docs
COPY installers ./installers
COPY site ./site

# Local default: site at http://localhost:8080/.
# Use ASTRO_BASE=/Photoshop-MCP for GitHub Pages path parity.
ARG ASTRO_SITE=http://localhost:8080
ARG ASTRO_BASE=/
ENV ASTRO_SITE=$ASTRO_SITE \
    ASTRO_BASE=$ASTRO_BASE

RUN pnpm --dir site build

# --- runtime ---
FROM nginx:1.27-alpine AS runtime

COPY site/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/site/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
