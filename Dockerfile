# Usamos una versión ligera de Node.js
FROM node:20-slim

# Instalamos solo lo mínimo necesario para dependencias de red de Baileys si hiciera falta
# (En la mayoría de los casos con node-slim es suficiente para un bot simple)
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy app source
COPY . .

# Expose port
EXPOSE 3000

# Start command
CMD ["npm", "start"]
