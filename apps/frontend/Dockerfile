FROM node:20-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml ./
COPY apps/frontend/package.json ./apps/frontend/
COPY packages/database/package.json ./packages/database/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY apps/frontend ./apps/frontend
COPY packages/database ./packages/database
COPY apps/frontend/next.config.js ./
COPY apps/frontend/next-env.d.ts ./

EXPOSE 3000

CMD ["pnpm", "--filter", "@agentbook/frontend", "dev"]
