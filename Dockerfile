# adapted from https://nodejs.org/en/docs/guides/nodejs-docker-webapp/
FROM node:20.11.1-alpine3.19
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm install
EXPOSE 3000
CMD [ "npm", "run", "start" ]
