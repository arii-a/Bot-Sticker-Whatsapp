FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
# La sesión de WhatsApp se guarda aquí: monta un volumen persistente en /data
ENV AUTH_DIR=/data/auth
CMD ["node", "index.js"]
