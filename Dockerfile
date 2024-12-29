FROM node:18-alpine

ENV APP_DIR=/home/node

WORKDIR $APP_DIR

COPY yarn.lock package.json $APP_DIR/

RUN yarn install --production && yarn cache clean

COPY . $APP_DIR

EXPOSE 19594

CMD ["npm", "run", "docker:start"]