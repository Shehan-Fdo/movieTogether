# Use lightweight alpine Node.js image
FROM node:24-alpine

# Set working directory inside container
WORKDIR /app

# Copy package configurations
COPY package.json ./
COPY backend/package.json ./backend/

# Install dependencies using root prefix scripts
RUN npm run build

# Copy remaining source code
COPY . .

# Expose server port
EXPOSE 5000

# Set environment
ENV NODE_ENV=production

# Boot command
CMD ["npm", "start"]
