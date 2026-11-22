FROM node:24-alpine

WORKDIR /app

# Install production dependencies from the lockfile before copying the application source.
COPY package*.json ./
RUN npm ci --omit=dev

# Copy the server entry point, its modules, and the browser assets it serves.
COPY app.js ./
COPY db.js ./
COPY doubles.js ./
COPY frontend ./frontend

# Run the app process as the non-root user provided by the base image.
USER node

# Document the container port used by the default server command.
EXPOSE 3000

CMD ["node", "app.js"]
