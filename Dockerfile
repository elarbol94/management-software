# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS deps
WORKDIR /app
# Native dependencies such as better-sqlite3 fall back to a source build when
# their prebuilt binary cannot be downloaded. Keep the compiler toolchain in
# this disposable stage so transient GitHub failures do not break deployment.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      python3 \
      make \
      g++ \
    && rm -rf /var/lib/apt/lists/*
# The npm bundled with this image (10.x) mishandles optional-dependency
# platform filtering (EBADPLATFORM on unrelated CPU/OS variants like
# @esbuild/aix-ppc64) — upgrade before installing to avoid that bug.
RUN npm install -g npm@11
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV BETTER_AUTH_SECRET=build-only-secret-not-for-runtime
# Build-time DB path so the build never touches a real database.
ENV DATABASE_PATH=/tmp/build.db
RUN --mount=type=cache,target=/app/.next/cache npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_PATH=/data/app.db \
    UPLOADS_PATH=/data/uploads \
    MAX_PDF_UPLOAD_BYTES=104857600 \
    PDF_OCR_LANGUAGES=deu+eng
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      poppler-utils \
      tesseract-ocr \
      tesseract-ocr-deu \
      tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system app \
    && useradd --system --gid app app \
    && mkdir -p /data \
    && chown app:app /data
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
# Drizzle migrations are applied on boot by src/instrumentation.ts
COPY --from=build --chown=app:app /app/drizzle ./drizzle
USER app
EXPOSE 3000
VOLUME /data
CMD ["node", "server.js"]
