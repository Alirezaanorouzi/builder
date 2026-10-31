FROM ghcr.io/anomalyco/opencode:latest

USER root

RUN (command -v apk >/dev/null && apk add --no-cache git) \
  || (command -v apt-get >/dev/null && apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*) \
  || (command -v microdnf >/dev/null && microdnf install -y git) \
  || (command -v dnf >/dev/null && dnf install -y git) \
  || (command -v yum >/dev/null && yum install -y git) \
  || (echo "Could not install git" && exit 1)

COPY opencode.json /etc/opencode/opencode.json
