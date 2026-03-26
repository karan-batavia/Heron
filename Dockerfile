FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
COPY bin/ bin/
RUN npx tsc

FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist/ dist/
ENV NODE_ENV=production
EXPOSE 3700
CMD ["node", "dist/bin/heron.js", "serve"]
