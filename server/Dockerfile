FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm i tsx@4
COPY . .
ENV FLOW_DB=/data/flow-coach.db FLOW_OUT_DIR=/data/out PORT=8787
EXPOSE 8787
CMD ["npx", "tsx", "src/server.ts"]
