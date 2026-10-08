FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1

WORKDIR /app
ENV NODE_ENV=production \
    CONTAINER_RUNTIME=true \
    BIND_HOST=0.0.0.0 \
    PORT=3030 \
    REPORTS_DIR=/tmp/passenger-flow-reports \
    AUTO_INIT_SCHEMA=false \
    SEED_DEMO_DATA=false
ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=${GIT_COMMIT}

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit && npm cache clean --force

COPY --chown=node:node . .
RUN node scripts/vendor-assets.js && chown -R node:node /app/public/vendor

USER node
EXPOSE 3030
ENTRYPOINT ["sh", "scripts/container-entrypoint.sh"]
CMD ["node", "app.js"]
