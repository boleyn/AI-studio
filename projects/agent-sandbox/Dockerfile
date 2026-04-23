# Agent Sandbox 镜像
# 提供 code-server 开发环境
#
# 构建：docker build -t fastgpt-agent-sandbox:latest .
# 产物：fastgpt-agent-sandbox:latest
FROM docker.m.daocloud.io/library/ubuntu:24.04

# Avoid prompts during installation
ENV DEBIAN_FRONTEND=noninteractive
RUN if [ -f /etc/apt/sources.list.d/ubuntu.sources ]; then \
      sed -i 's|http://ports.ubuntu.com/ubuntu-ports|http://mirrors.aliyun.com/ubuntu-ports|g' /etc/apt/sources.list.d/ubuntu.sources; \
    fi \
  && if [ -f /etc/apt/sources.list ]; then \
      sed -i 's|http://ports.ubuntu.com/ubuntu-ports|http://mirrors.aliyun.com/ubuntu-ports|g' /etc/apt/sources.list; \
    fi

# Install dependencies
RUN apt-get update && apt-get install -y \
    git \
    jq \
    ripgrep \
    pandoc \
    vim-tiny \
    tree \
    zip \
    unzip \
    curl \
    ca-certificates
RUN curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
RUN apt install -y \
    python3 \
    python3-pip \
    python3-numpy \
    python3-pandas \
    python3-openpyxl \
    python3-lxml \
    python3-defusedxml \
    python3-scipy \
    python3-matplotlib \
    nodejs
RUN python3 -m pip install --break-system-packages --no-cache-dir \
    python-docx \
    xlrd \
    odfpy \
    pyxlsb \
    xlsxwriter
RUN npm install -g tsx
RUN rm -rf /var/lib/apt/lists/*

# Install code-server using the official script
RUN curl -fsSL https://code-server.dev/install.sh | sh

# Create a non-root user for security
RUN useradd --create-home --shell /bin/bash sandbox

USER root
WORKDIR /home/sandbox

# Copy VS Code settings
RUN mkdir -p /home/sandbox/.local/share/code-server/User
COPY --chown=sandbox:sandbox settings.json /home/sandbox/.local/share/code-server/User/settings.json

# Copy and configure entrypoint
COPY --chown=sandbox:sandbox entrypoint.sh /home/sandbox/entrypoint.sh
COPY --chown=sandbox:sandbox exec-server.ts /home/sandbox/exec-server.ts
RUN chmod +x /home/sandbox/entrypoint.sh

# Expose code-server port
EXPOSE 8080
EXPOSE 8091

ENTRYPOINT ["/home/sandbox/entrypoint.sh"]
