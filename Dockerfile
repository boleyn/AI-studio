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
ENV PIP_INDEX_URL=${PIP_INDEX_URL}
ENV PIP_TRUSTED_HOST=${PIP_TRUSTED_HOST}
RUN npm config set registry ${NPM_REGISTRY} \
  && rm -f /usr/local/bin/yarn /usr/local/bin/yarnpkg \
  && npm install -g @yarnpkg/cli-dist@4.5.1 \
  && python3 -m pip config set global.index-url ${PIP_INDEX_URL} \
  && python3 -m pip config set global.trusted-host ${PIP_TRUSTED_HOST} \
  && python3 -m pip install --no-cache-dir \
    python-docx \
    xlrd \
    odfpy \
    pyxlsb \
    xlsxwriter

FROM base AS deps
ARG NPM_REGISTRY
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
