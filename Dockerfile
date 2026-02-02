FROM node:20-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    libvips \
    libvips-dev \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY requirements.txt ./requirements.txt
RUN pip3 install --no-cache-dir -r requirements.txt

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8080
ENV WSI_ROOT=/app
ENV WSI_PYTHON_BIN=python3

EXPOSE 8080

CMD ["npm", "run", "start", "--", "-p", "8080"]
