# docker build -f deploy/api.Dockerfile .

FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/ethiopian-calendar/package.json packages/ethiopian-calendar/
COPY packages/i18n/package.json packages/i18n/
COPY packages/ui/package.json packages/ui/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
COPY apps/customer/package.json apps/customer/
COPY apps/staff/package.json apps/staff/
COPY apps/owner/package.json apps/owner/
COPY apps/admin/package.json apps/admin/
RUN npm ci
COPY tsconfig.base.json ./
COPY packages/db packages/db
COPY apps/api apps/api
RUN npm run build -w @temelash/db && npm run build -w @temelash/api
# Keep only what the API needs at runtime.
RUN npm ci --omit=dev -w @temelash/api -w @temelash/db --include-workspace-root=false

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production API_PORT=4000
COPY --from=build --chown=node:node /repo/package.json ./
COPY --from=build --chown=node:node /repo/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/packages/db/package.json ./packages/db/package.json
COPY --from=build --chown=node:node /repo/packages/db/dist ./packages/db/dist
COPY --from=build --chown=node:node /repo/packages/db/migrations ./packages/db/migrations
COPY --from=build --chown=node:node /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /repo/apps/api/dist ./apps/api/dist
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:4000/api/v1/health >/dev/null || exit 1
CMD ["node", "apps/api/dist/main.js"]
