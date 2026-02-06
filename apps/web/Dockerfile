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

# Vite bakes VITE_* env vars into the bundle at build time
ARG VITE_API_URL
ARG VITE_GITHUB_APP_SLUG
ARG VITE_VAPID_PUBLIC_KEY
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_GITHUB_APP_SLUG=$VITE_GITHUB_APP_SLUG
ENV VITE_VAPID_PUBLIC_KEY=$VITE_VAPID_PUBLIC_KEY

# Build web app (Vite handles workspace dependencies)
RUN pnpm --filter @overlap/web build

# Set port for Nitro server (Railway will route traffic here)
ENV PORT=8080
EXPOSE 8080

# Start the web app
CMD ["pnpm", "--filter", "@overlap/web", "start"]
