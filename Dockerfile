FROM mcr.microsoft.com/playwright:v1.48.0-jammy

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm install --no-save tsx

COPY . .

ENV NODE_ENV=production
ENV APP_ENV=production

# Default command — DO App Platform job overrides via run_command per job.
CMD ["npm", "run", "scrape", "--", "--notify=morning"]
