#!/bin/bash

# Set work directory from environment variable, default to /home/sandbox
WORKDIR="${FASTGPT_WORKDIR:-/home/sandbox}"
mkdir -p "${WORKDIR}"
chown -R sandbox:sandbox "${WORKDIR}"

# Capture the flag before unsetting, then clear all FastGPT runtime vars
_ENABLE_CODE_SERVER="${FASTGPT_ENABLE_CODE_SERVER}"
_EXEC_PORT="${FASTGPT_EXEC_PORT:-8091}"
unset FASTGPT_SESSION_ID FASTGPT_WORKDIR FASTGPT_ENABLE_CODE_SERVER

# The control service stays privileged only to reconcile shared-volume ownership.
# It explicitly drops every command process to the unprivileged sandbox uid.
tsx /home/sandbox/exec-server.ts &

# Start code-server or sleep forever
if [ "${_ENABLE_CODE_SERVER}" = "true" ] && command -v code-server >/dev/null 2>&1; then
  exec runuser -u sandbox -- code-server \
       --disable-telemetry \
       --disable-update-check \
       --disable-workspace-trust \
       --disable-getting-started-override \
       --app-name "Skills" \
       --user-data-dir /home/sandbox/.local/share/code-server \
       "${WORKDIR}"
else
  exec sleep infinity
fi
