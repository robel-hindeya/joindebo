# One image per Next.js app: docker build -f deploy/web.Dockerfile --build-arg APP=staff .
# APP is one of: customer, staff, owner, admin.

FROM node:22-alpine AS build
ARG APP
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
COPY packages packages
COPY apps/${APP} apps/${APP}
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @temelash/ethiopian-calendar -w @temelash/i18n -w @temelash/ui \
 && npm run build -w @temelash/${APP}

FROM node:22-alpine AS run
ARG APP
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /repo/apps/${APP}/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/${APP}/.next/static ./apps/${APP}/.next/static
USER node
EXPOSE 3000
ENV APP=${APP}
CMD ["sh", "-c", "exec node apps/$APP/server.js"]
