FROM node:20-slim

# Install pnpm
RUN npm install -g pnpm

WORKDIR /app

# Copy workspace config files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.json ./

# Copy packages and app
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build API (tsup bundles workspace dependencies)
RUN pnpm --filter @overlap/api build

# Start the API
CMD ["node", "apps/api/dist/index.js"]
