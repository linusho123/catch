# The Catch server on Fly.io (app catch-g2, region lax). Node strips the
# TypeScript types at load, so there is no build step: the server's sources and
# the one runtime dependency (ws) are all the image holds.
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY shared ./shared
COPY server/src ./server/src
EXPOSE 8080
CMD ["node", "server/src/main.ts"]
