FROM node:20-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip \
    && pip3 install --break-system-packages --no-cache-dir openpyxl==3.1.5 pyxlsb==1.0.10 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY telegram-bot.js ./
COPY telegram-web-app.js ./
COPY public ./public
COPY tools ./tools
COPY data/uploads/.gitkeep ./data/uploads/.gitkeep

ENV NODE_ENV=production
ENV PORT=4173
ENV HOST=0.0.0.0
ENV PYTHON_PATH=python3
EXPOSE 4173

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4173/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
