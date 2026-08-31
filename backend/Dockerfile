FROM node:20-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends fontconfig fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# sharp uses prebuilt binaries on Debian/glibc - no build from source needed
COPY package*.json ./
RUN npm install

COPY . .

RUN chmod +x entrypoint.sh

EXPOSE 5000

ENTRYPOINT ["sh", "./entrypoint.sh"]
CMD ["node", "server.js"]
