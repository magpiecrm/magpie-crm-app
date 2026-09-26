FROM oven/bun:1 as base
WORKDIR /app

# Install Node/NPM: npx installs Playwright's Chromium below.
RUN apt-get update && apt-get install -y curl gnupg && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# System libraries Chromium needs, so the copilot's `previewEmail` tool can
# render a design to an image. Without these the browser binary is present but
# will not start, and previews degrade to the text-only lint report.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
    libasound2 libpango-1.0-0 libcairo2 libnss3 libnspr4 fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Install app dependencies
COPY package.json bun.lock ./
RUN bun install

# Copy project files
COPY . .

# Install Chromium under /app so it ends up owned by the non-root runtime
# user below, rather than under root's home directory.
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.cache/ms-playwright

# Download the Chromium that playwright-core drives for email previews.
RUN npx --yes playwright@1.63.0 install chromium

# Build the project
RUN bun run build

# Run the app as an unprivileged user. gosu lets the entrypoint start as root
# (needed to chown the mounted volume below) and then drop to that user before
# exec'ing the real process.
RUN apt-get update && apt-get install -y --no-install-recommends gosu && \
    rm -rf /var/lib/apt/lists/* && \
    groupadd --system appuser && \
    useradd --system --create-home --gid appuser appuser && \
    chown -R appuser:appuser /app
ENV HOME=/home/appuser

# Production mounts a persistent volume at RAILWAY_VOLUME_MOUNT_PATH (/data,
# also used as HOME and for DATABASE_PATH) that is root-owned from before
# this user existed. The entrypoint chowns it to appuser at container start
# — before dropping privileges — since that can't be done at build time.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000
ENV PORT=3000

ENTRYPOINT ["docker-entrypoint.sh"]

# Run the app in production mode (see serve.ts; PORT is set above)
CMD ["bun", "serve.ts"]
