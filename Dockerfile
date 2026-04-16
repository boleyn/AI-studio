ARG NODE_IMAGE=docker.io/library/node:20.14.0-alpine
FROM ${NODE_IMAGE} AS base
WORKDIR /app
ARG APK_MIRROR=mirrors.aliyun.com
ARG PIP_INDEX_URL=https://pypi.mirrors.ustc.edu.cn/simple
ARG PIP_TRUSTED_HOST=pypi.mirrors.ustc.edu.cn
RUN ALPINE_VERSION="$(cut -d. -f1,2 /etc/alpine-release)" \
  && printf "https://%s/alpine/v%s/main\nhttps://%s/alpine/v%s/community\n" \
    "${APK_MIRROR}" "${ALPINE_VERSION}" "${APK_MIRROR}" "${ALPINE_VERSION}" > /etc/apk/repositories \
  && apk add --no-cache \
    libc6-compat \
    bash \
    ripgrep \
    pandoc \
    python3 \
    py3-pip \
    py3-numpy \
    py3-pandas \
    py3-openpyxl \
    py3-lxml \
    py3-defusedxml \
    py3-scipy \
    py3-matplotlib
ARG NPM_REGISTRY=https://registry.npmmirror.com
ENV NPM_REGISTRY=${NPM_REGISTRY}
ENV NPM_CONFIG_REGISTRY=${NPM_REGISTRY}
ENV RIPGREP_PATH=/usr/bin/rg
ENV PIP_INDEX_URL=${PIP_INDEX_URL}
ENV PIP_TRUSTED_HOST=${PIP_TRUSTED_HOST}
RUN if [ -n "${NPM_REGISTRY}" ]; then npm config set registry "${NPM_REGISTRY}"; fi \
  && npm install -g bun@1.3.10 \
  && if [ -n "${PIP_INDEX_URL}" ]; then python3 -m pip config set global.index-url "${PIP_INDEX_URL}"; fi \
  && if [ -n "${PIP_TRUSTED_HOST}" ]; then python3 -m pip config set global.trusted-host "${PIP_TRUSTED_HOST}"; fi \
  && python3 -m pip install --break-system-packages --no-cache-dir \
    python-docx \
    xlrd \
    odfpy \
    pyxlsb \
    xlsxwriter

FROM base AS deps
ARG NPM_REGISTRY=https://registry.npmmirror.com
COPY package.json bun.lock ./
RUN if [ -n "${NPM_REGISTRY}" ]; then npm config set registry "${NPM_REGISTRY}"; fi \
  && if [ -n "${NPM_REGISTRY}" ]; then bun config set registry "${NPM_REGISTRY}"; fi \
  && bun install --frozen-lockfile

FROM base AS builder
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.js ./next.config.js
COPY --from=builder /app/skills ./skills
COPY --from=builder /app/data/project-templates ./data/project-templates
COPY --from=builder /app/AGENTS.md ./AGENTS.md

EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-p", "3000"]
