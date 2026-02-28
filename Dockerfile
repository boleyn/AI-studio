FROM node:20-alpine AS base
WORKDIR /app
ARG APK_MIRROR=mirrors.aliyun.com
RUN ALPINE_VERSION="$(cut -d. -f1,2 /etc/alpine-release)" \
  && printf "https://%s/alpine/v%s/main\nhttps://%s/alpine/v%s/community\n" \
    "${APK_MIRROR}" "${ALPINE_VERSION}" "${APK_MIRROR}" "${ALPINE_VERSION}" > /etc/apk/repositories \
  && apk add --no-cache libc6-compat
ARG NPM_REGISTRY=https://registry.npmmirror.com
ARG YARN_VERSION=4.5.1
ENV NPM_CONFIG_REGISTRY=${NPM_REGISTRY}
RUN npm config set registry ${NPM_REGISTRY} \
  && rm -f /usr/local/bin/yarn /usr/local/bin/yarnpkg \
  && npm install -g @yarnpkg/cli-dist@${YARN_VERSION}

FROM base AS deps
COPY package.json yarn.lock ./
RUN npm config set registry ${NPM_REGISTRY} \
  && yarn config set npmRegistryServer ${NPM_REGISTRY} \
  && yarn config set nodeLinker node-modules \
  && yarn install --immutable

FROM base AS builder
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.js ./next.config.js
COPY --from=builder /app/skills ./skills
COPY --from=builder /app/AGENTS.md ./AGENTS.md

EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-p", "3000"]
