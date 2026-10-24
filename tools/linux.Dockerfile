# The CI runner's system for tools/linux.js: Ubuntu 24.04 with Node and the
# libraries Playwright's Chromium needs. The repo and its Linux node_modules
# are mounted at run time, not copied in.
FROM ubuntu:24.04

ARG NODE=v24.22.1
ARG NODE_SHA256=6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6
ARG PLAYWRIGHT=1.64.1

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl xz-utils git \
  && curl -fsSLo /tmp/node.tar.xz "https://nodejs.org/dist/${NODE}/node-${NODE}-linux-x64.tar.xz" \
  && echo "${NODE_SHA256}  /tmp/node.tar.xz" | sha256sum -c - \
  && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
  && rm /tmp/node.tar.xz \
  && npx -y "playwright@${PLAYWRIGHT}" install-deps chromium \
  && rm -rf /var/lib/apt/lists/* /root/.npm

# The repo belongs to the Windows user; git refuses it without this.
RUN git config --global --add safe.directory /repo
WORKDIR /repo
