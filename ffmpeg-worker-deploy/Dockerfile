# FFmpeg worker (Hetzner). Runs repurpose jobs; main app sends work via POST /job.
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libimage-exiftool-perl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3100
EXPOSE 3100

# Run from repo root so ../src resolves
CMD ["node", "ffmpeg-worker/server.js"]
