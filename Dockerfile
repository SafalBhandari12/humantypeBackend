#Build
FROM node:20 AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

#Run
FROM node:20-alpine AS run
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

RUN addgroup -S app && adduser -S app -G app
USER app

CMD ["node", "dist/index.js"]