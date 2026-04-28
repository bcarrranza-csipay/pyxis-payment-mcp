# ── Stage 1: builder ──────────────────────────────────────────────────────────
# Installs all dependencies (including devDependencies) and compiles TypeScript.
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first for better layer caching
COPY package.json package-lock.json ./

# Install all dependencies (devDependencies needed for tsc)
RUN npm ci

# Copy TypeScript config and source
COPY tsconfig.json ./
COPY src/ ./src/

# Compile TypeScript → dist/
RUN npm run build

# ── Stage 2: runner ───────────────────────────────────────────────────────────
# Installs production-only dependencies and copies compiled output.
# Excludes typescript, tsx, vitest — keeps the final image small (~200 MB).
FROM node:20-alpine AS runner

WORKDIR /app

# Copy package files for production install
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy compiled JavaScript from the builder stage
COPY --from=builder /app/dist ./dist

# App Runner default port convention (actual port controlled by PORT env var)
EXPOSE 8080

# Start the HTTP bridge (not the stdio MCP server)
CMD ["node", "dist/http-bridge.js"]
