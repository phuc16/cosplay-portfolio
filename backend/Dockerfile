FROM node:20-slim

WORKDIR /app

# sharp uses prebuilt binaries on Debian/glibc - no build from source needed
COPY package*.json ./
RUN npm install

COPY . .

RUN chmod +x entrypoint.sh

EXPOSE 5000

ENTRYPOINT ["sh", "./entrypoint.sh"]
