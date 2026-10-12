# Image of the google-multi MCP server.
#   MCP server (stdio): docker run -i --rm -v ~/.config/google-multi-mcp:/config ghcr.io/dathims/google-multi-mcp
#   Add an account    : docker run -it --rm -p 127.0.0.1:8765:8765 -v ~/.config/google-multi-mcp:/config ghcr.io/dathims/google-multi-mcp add perso

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
LABEL org.opencontainers.image.title="google-multi-mcp" \
      org.opencontainers.image.description="MCP server giving AI agents access to several Google accounts: Gmail, Google Calendar, Google Drive" \
      org.opencontainers.image.source="https://github.com/dathims/google-multi-mcp" \
      org.opencontainers.image.url="https://plugin.usecockpit.co/google-multi/" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="OXYGENE NUMERIQUE"

# Credentials and tokens live in the /config volume, never in the image.
# No browser in the container: add-account prints the URL and listens
# on a fixed port, to be published on 127.0.0.1 on the host side.
ENV NODE_ENV=production \
    GOOGLE_MULTI_MCP_DIR=/config \
    GOOGLE_MULTI_MCP_NO_BROWSER=1 \
    GOOGLE_MULTI_MCP_OAUTH_HOST=0.0.0.0 \
    GOOGLE_MULTI_MCP_OAUTH_PORT=8765

WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json LICENSE ./
RUN mkdir -p /config && chown node:node /config

USER node
VOLUME ["/config"]
EXPOSE 8765
ENTRYPOINT ["node", "/app/dist/entry.js"]
