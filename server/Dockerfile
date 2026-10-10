FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund || true
COPY src ./src
RUN mkdir -p /app/data /app/data/proofs
ENV PORT=8787 NODE_ENV=production LP_DATA_DIR=/app/data LP_PROOFS_DIR=/app/data/proofs
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]
