#!/bin/sh

echo "Waiting for MySQL..."
sleep 5

echo "Running migrations..."
npx knex migrate:latest

echo "Running seeds..."
npx knex seed:run

echo "Starting server..."
node server.js
