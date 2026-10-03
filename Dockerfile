# JARVIS server only (the phone app is built separately). Works on Render, Railway, Fly.io, any Docker host.
FROM node:20-slim
WORKDIR /app/server
COPY server/package.json ./
RUN npm install --omit=dev
COPY server/ ./
ENV NODE_ENV=production
EXPOSE 8787
CMD ["node", "index.js"]
