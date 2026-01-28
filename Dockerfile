# adapted from https://nodejs.org/en/docs/guides/nodejs-docker-webapp/
FROM node:22.22.0-alpine3.23
RUN apk update && apk upgrade
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm install
EXPOSE 3000
CMD [ "npm", "run", "start" ]
