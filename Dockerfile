# syntax=docker/dockerfile:1

# ---- build stage: full dependencies, compile TypeScript ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime stage: production dependencies and compiled output only ----
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    BIND_HOST=0.0.0.0
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# No API key is baked in. Pass it at run time: -e ANTHROPIC_API_KEY=...  (without it the app runs in demo mode)
CMD ["node", "dist/index.js"]
