# adapted from https://nodejs.org/en/docs/guides/nodejs-docker-webapp/
FROM node:22.23.4-alpine3.24
RUN apk update && apk upgrade
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
USER node
EXPOSE 3000
CMD [ "npm", "run", "start" ]
