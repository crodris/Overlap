FROM node:20-slim

# Install pnpm
RUN npm install -g pnpm

WORKDIR /app

# Copy workspace files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/ ./packages/
COPY apps/web/ ./apps/web/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build the web app
RUN pnpm --filter @overlap/web build

# Expose port
EXPOSE 3000

# Start the web app
CMD ["pnpm", "--filter", "@overlap/web", "start"]
