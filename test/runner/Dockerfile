# A minimal stand-in for GitHub's ubuntu-* runner images, for running the
# workflows locally with act (see script/e2e-local.sh)
ARG UBUNTU=26.04
FROM node:24 AS node
FROM ubuntu:${UBUNTU}
COPY --from=node /usr/local/bin/node /usr/local/bin/node
RUN apt-get update -q \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends \
        ca-certificates cmake docker.io file git ninja-build sudo \
    && rm -rf /var/lib/apt/lists/*
