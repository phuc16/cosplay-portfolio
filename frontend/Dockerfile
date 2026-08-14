FROM node:20-alpine as build
WORKDIR /app
COPY . .
RUN npm install
# Vite inlines VITE_* vars into the built JS at compile time — must be an
# ARG/ENV here, not a runtime container env var, or it never reaches the
# bundle. Optional: an unset key just makes AddressFields.jsx degrade to a
# plain textarea (see frontend/src/components/shop/AddressFields.jsx).
ARG VITE_GOONG_API_KEY
ENV VITE_GOONG_API_KEY=$VITE_GOONG_API_KEY
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
