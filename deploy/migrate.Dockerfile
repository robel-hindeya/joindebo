# One-shot job for the local Docker stack: applies packages/db/migrations, then exits.
# Keeps tsx, which the API image leaves out.

FROM node:22-alpine
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/codes/package.json packages/codes/
COPY packages/ethiopian-calendar/package.json packages/ethiopian-calendar/
COPY packages/i18n/package.json packages/i18n/
COPY packages/ui/package.json packages/ui/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
COPY apps/customer/package.json apps/customer/
COPY apps/staff/package.json apps/staff/
COPY apps/owner/package.json apps/owner/
COPY apps/admin/package.json apps/admin/
RUN npm ci -w @temelash/db --include-workspace-root=false
COPY tsconfig.base.json ./
COPY packages/db packages/db
WORKDIR /repo/packages/db
USER node
CMD ["npx", "tsx", "src/migrate.ts"]
