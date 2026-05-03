FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 9000 9001
VOLUME ["/app/data"]

CMD ["node", "server.js"]
