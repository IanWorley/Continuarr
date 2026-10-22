FROM oven/bun:1.4.4 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1.4.4 AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIRECTORY=/data
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json /app/tsconfig.json /app/drizzle.config.ts ./
COPY --from=build /app/src ./src
COPY --from=build /app/drizzle/postgres ./drizzle/postgres
COPY --from=build /app/scripts/start.ts /app/scripts/production.ts ./scripts/
RUN mkdir /data && chown bun:bun /data
USER bun
EXPOSE 3000
CMD ["bun", "run", "start"]
