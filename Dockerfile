ARG NODE_IMAGE=docker.m.daocloud.io/library/node:20.14.0-alpine
FROM ${NODE_IMAGE} AS base
WORKDIR /app
ARG APK_MIRROR=mirrors.aliyun.com
RUN ALPINE_VERSION="$(cut -d. -f1,2 /etc/alpine-release)" \
  && printf "https://%s/alpine/v%s/main\nhttps://%s/alpine/v%s/community\n" \
    "${APK_MIRROR}" "${ALPINE_VERSION}" "${APK_MIRROR}" "${ALPINE_VERSION}" > /etc/apk/repositories \
  && apk add --no-cache \
    libc6-compat \
    bash \
    make \
    g++ \
    linux-headers \
    ripgrep \
    tini \
    shadow \
    util-linux
ARG NPM_REGISTRY=https://registry.npmmirror.com
ENV NPM_REGISTRY=${NPM_REGISTRY}
ENV NPM_CONFIG_REGISTRY=${NPM_REGISTRY}
ENV RIPGREP_PATH=/usr/bin/rg
RUN if [ -n "${NPM_REGISTRY}" ]; then npm config set registry "${NPM_REGISTRY}"; fi \
  && npm install -g bun@1.3.10

FROM base AS deps
ARG NPM_REGISTRY=https://registry.npmmirror.com
COPY package.json bun.lock ./
COPY vendor ./vendor
RUN apk add --no-cache python3 \
  && if [ -n "${NPM_REGISTRY}" ]; then npm config set registry "${NPM_REGISTRY}"; fi \
  && bun install --frozen-lockfile

FROM base AS builder
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV AGENT_SANDBOX_S3_ENABLED=true
ENV AGENT_SANDBOX_S3_PREFIX=agent_sandbox_workspaces
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.js ./next.config.js
COPY --from=builder /app/skills ./skills
COPY --from=builder /app/data/project-templates ./data/project-templates
COPY --from=builder /app/AGENTS.md ./AGENTS.md

RUN mkdir -p /app/.aistudio/sandboxes /app/.aistudio/runtime \
  && chmod -R 775 /app/.aistudio

EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node_modules/.bin/next", "start", "-p", "3000"]
