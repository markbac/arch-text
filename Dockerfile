# syntax=docker/dockerfile:1
# The arch-text command line with Node and Chromium baked in, so a docs repository can
# regenerate diagrams on every commit without downloading a browser (docs/docs-repo.md).
#
#   docker build -t arch-text .
#   docker run --rm --network none -v "$PWD:/work" arch-text render "docs/**/*.archt"
#
# Export needs no network at all: Excalidraw's fonts are inside the image (ADR-004).

# Build: the compiler, the export page, and the same tarball a release attaches.
FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build \
 && mkdir /release \
 && npm pack --pack-destination /release

# The command line: installed from the tarball, with the headless shell of Playwright's
# Chromium (all that headless export uses) and its system libraries.
FROM node:22-bookworm-slim
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright \
    NODE_ENV=production
COPY --from=build /release/arch-text-*.tgz /tmp/
RUN npm install -g --no-audit --no-fund /tmp/arch-text-*.tgz \
 && rm /tmp/arch-text-*.tgz \
 && node "$(npm root -g)/arch-text/node_modules/playwright-core/cli.js" install --with-deps --only-shell chromium \
 && rm -rf /var/lib/apt/lists/* /root/.npm \
 && chmod -R a+rX /opt/playwright
LABEL org.opencontainers.image.source="https://github.com/markbac/arch-text" \
      org.opencontainers.image.description="Architecture diagrams as text, compiled to Excalidraw, with offline SVG and PNG export" \
      org.opencontainers.image.licenses="MIT"
# Any user can run it (docker run --user "$(id -u):$(id -g)" keeps output files yours);
# HOME is somewhere every user can write, for Chromium's caches.
ENV HOME=/tmp
USER node
WORKDIR /work
ENTRYPOINT ["arch-text"]
CMD ["--help"]
