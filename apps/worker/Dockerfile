FROM node:20-slim

# Install pnpm
RUN npm install -g pnpm

WORKDIR /app

# Copy workspace config files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.json ./

# Copy packages and app
COPY packages/ ./packages/
COPY apps/worker/ ./apps/worker/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build worker (tsup bundles workspace dependencies)
RUN pnpm --filter @overlap/worker build

# Start the worker
CMD ["node", "apps/worker/dist/index.js"]
