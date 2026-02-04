FROM node:20-slim

# Install pnpm
RUN npm install -g pnpm

WORKDIR /app

# Copy workspace config files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.json ./

# Copy packages and app
COPY packages/ ./packages/
COPY apps/web/ ./apps/web/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build web app (Vite handles workspace dependencies)
RUN pnpm --filter @overlap/web build

# Expose port
EXPOSE 3000

# Start the web app
CMD ["pnpm", "--filter", "@overlap/web", "start"]
