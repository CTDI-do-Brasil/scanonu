# Build date: 2026-06-24T10:17:00Z - Force CapRover rebuild without cache
FROM node:20-alpine AS build-frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM node:20-alpine AS build-backend
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm install
# Build date: 2026-06-24T10:17:00Z - Force backend rebuild
COPY backend/ ./
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY backend/package*.json ./backend/
RUN cd backend && npm install --only=production
COPY --from=build-backend /app/backend/dist ./backend/dist
COPY --from=build-frontend /app/frontend/dist ./public
EXPOSE 3001
ENV NODE_ENV=production
CMD ["node", "backend/dist/server.js"]
