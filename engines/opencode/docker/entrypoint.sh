#!/bin/sh
set -e

WORKDIR="${WORKSPACE_DIR:-/workspace}"
REF="${TEMPLATE_REPO_REF:-main}"
REPO_TOKEN="${TEMPLATE_REPO_TOKEN:-${GITHUB_TOKEN:-}}"

mkdir -p "$WORKDIR"

# OpenCode reads /workspace/opencode.json for default model (see docker/opencode.json).
if [ -f /etc/opencode/opencode.json ] && [ ! -f "$WORKDIR/opencode.json" ]; then
  cp /etc/opencode/opencode.json "$WORKDIR/opencode.json"
  echo "Installed opencode.json in workspace."
fi

if [ -n "${TEMPLATE_REPO_URL:-}" ] && [ ! -d "$WORKDIR/.git" ]; then
  echo "Cloning template repo into $WORKDIR ..."
  CLONE_URL="$TEMPLATE_REPO_URL"
  if [ -n "$REPO_TOKEN" ]; then
    CLONE_URL=$(echo "$TEMPLATE_REPO_URL" | sed "s#https://#https://x-access-token:${REPO_TOKEN}@#")
  fi
  if git clone --depth 1 --branch "$REF" "$CLONE_URL" "$WORKDIR" 2>/dev/null || git clone "$CLONE_URL" "$WORKDIR"; then
    echo "Clone OK."
  else
    echo "WARN: git clone failed (set TEMPLATE_REPO_TOKEN in docker/.env). Starting OpenCode anyway."
  fi
fi

if [ -d "$WORKDIR/.git" ]; then
  cd "$WORKDIR"
  git checkout "$REF" 2>/dev/null || true
  git pull origin "$REF" 2>/dev/null || true
  if [ -n "${TEMPLATE_REPO_GIT_EMAIL:-}" ]; then
    git config --global user.email "$TEMPLATE_REPO_GIT_EMAIL"
    git config --global user.name "${TEMPLATE_REPO_GIT_NAME:-Website Builder}"
    git config user.email "$TEMPLATE_REPO_GIT_EMAIL"
    git config user.name "${TEMPLATE_REPO_GIT_NAME:-Website Builder}"
    echo "Git author set for Vercel/GitHub commits."
  else
    echo "WARN: Set TEMPLATE_REPO_GIT_EMAIL in docker/.env so Vercel does not block deployments (unknown commit author)."
  fi
else
  cd "$WORKDIR"
fi

# Avoid OpenCode treating git token as GitHub Copilot (use TEMPLATE_REPO_TOKEN only in compose).
unset GITHUB_TOKEN

echo "Starting OpenCode server on 0.0.0.0:${OPENCODE_PORT:-4096} ..."
exec opencode serve --hostname 0.0.0.0 --port "${OPENCODE_PORT:-4096}"
