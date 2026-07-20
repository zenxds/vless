FROM node:20-bookworm-slim AS build

ENV APP_DIR=/app

WORKDIR ${APP_DIR}

COPY package.json yarn.lock tsconfig.json tsconfig.build.json ./
RUN yarn install --frozen-lockfile

COPY src ./src
RUN yarn compile

FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV APP_DIR=/app
ENV PORT=19594

WORKDIR ${APP_DIR}

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production=true && yarn cache clean

COPY ecosystem.config.example.js ./ecosystem.config.js
COPY --from=build /app/lib ./lib

EXPOSE 19594

CMD ["npm", "run", "docker:start"]
