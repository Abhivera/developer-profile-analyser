# ── Stage 1: Builder ──────────────────────────────────────────────────────────
# Compile TypeScript → JavaScript
FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
# Lean production image with Node + Python (for crawl4ai in python mode)
FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ARG DEBIAN_MIRROR=deb.debian.org
ARG CRAWL_RUNTIME=docker

# Install Python/Playwright dependencies only when local python crawl mode is needed.
RUN if [ "$CRAWL_RUNTIME" = "python" ]; then \
      sed -i "s|http://deb.debian.org/debian|http://${DEBIAN_MIRROR}/debian|g; s|http://deb.debian.org/debian-security|http://${DEBIAN_MIRROR}/debian-security|g" /etc/apt/sources.list.d/debian.sources \
      && printf 'Acquire::Retries "5";\nAcquire::http::Timeout "30";\nAcquire::https::Timeout "30";\nAcquire::http::Pipeline-Depth "0";\n' > /etc/apt/apt.conf.d/99network-tuning \
      && apt-get update && apt-get install -y --no-install-recommends \
      python3 \
      python3-pip \
      ca-certificates \
      curl \
      libnss3 \
      libnspr4 \
      libatk1.0-0 \
      libatk-bridge2.0-0 \
      libcups2 \
      libdrm2 \
      libxkbcommon0 \
      libxcomposite1 \
      libxdamage1 \
      libxfixes3 \
      libxrandr2 \
      libgbm1 \
      libasound2 \
      python3-venv \
      && rm -rf /var/lib/apt/lists/*; \
    else \
      echo "Skipping local Python/Playwright dependency install (CRAWL_RUNTIME=$CRAWL_RUNTIME)"; \
    fi

# Install production Node deps only
COPY package*.json ./
RUN npm ci --omit=dev

# Install Python packages only in local python crawl runtime.
COPY requirements-crawl.txt ./requirements-crawl.txt
RUN if [ "$CRAWL_RUNTIME" = "python" ]; then \
      pip3 install --no-cache-dir --break-system-packages -r requirements-crawl.txt; \
    else \
      echo "Skipping pip install (CRAWL_RUNTIME=$CRAWL_RUNTIME)"; \
    fi

# Install Playwright browser only in local python crawl runtime.
RUN if [ "$CRAWL_RUNTIME" = "python" ]; then \
      python3 -m playwright install chromium; \
    else \
      echo "Skipping playwright install (CRAWL_RUNTIME=$CRAWL_RUNTIME)"; \
    fi

# Copy compiled JS from builder
COPY --from=builder /app/dist ./dist

# Copy static files served by Express
COPY public ./public

# Copy Python crawl helper
COPY python ./python

EXPOSE 3000

CMD ["node", "dist/index.js"]
