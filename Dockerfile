FROM node:22.13.0-bookworm-slim

WORKDIR /workspace

ENV NODE_ENV=development \
    FURIMA_LOCAL_FIXTURE_MODE=true \
    FURIMA_STORAGE_MODE=memory \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    CHOKIDAR_USEPOLLING=true \
    WATCHPACK_POLLING=true

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0", "--port", "3000"]
