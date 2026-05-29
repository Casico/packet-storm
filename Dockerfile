FROM node:20-alpine

WORKDIR /app

# Install production deps only (use cached layer when package.json unchanged)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# App source
COPY server.js ./
COPY public/ ./public/

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

CMD ["node", "server.js"]
