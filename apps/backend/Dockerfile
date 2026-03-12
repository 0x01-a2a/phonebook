FROM node:20-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml ./
COPY apps/backend/package.json ./apps/backend/
COPY packages/database/package.json ./packages/database/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY apps/backend ./apps/backend
COPY packages/database ./packages/database

# Build
RUN pnpm --filter @phonebook/database generate

EXPOSE 3001

CMD ["pnpm", "--filter", "@phonebook/backend", "start"]
