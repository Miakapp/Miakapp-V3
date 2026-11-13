# Self-hosted control plane (see src/self-hosted-server.ts). The Cloud
# Functions packaging in deployment/ is unchanged.
FROM oven/bun:1.2.23 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN bunx tsc -p tsconfig.build.json \
  && rm -rf node_modules \
  && bun install --frozen-lockfile --production

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/lib ./lib
USER node
EXPOSE 8080
CMD ["node", "lib/self-hosted-server.js"]
