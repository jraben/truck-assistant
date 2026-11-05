# Slate Cockpit as a container: a bench/homelab copy of the brain + cockpit UI.
# The truck itself runs on a Raspberry Pi with systemd (deploy/pi); this image is
# for running it on a server (e.g. the NAS) with a simulated truck or real
# Home Assistant / WOPR connections. Built on GitHub (.github/workflows/build-image.yml).

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY brain/package.json brain/
COPY ui/package.json ui/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
# ffmpeg: the desk camera fallback (SIM test cameras, dashcam segments).
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/brain/package.json ./brain/
COPY --from=build /app/brain/dist ./brain/dist
COPY --from=build /app/ui/dist ./ui/dist
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    DASHCAM_DIR=/data/dashcam \
    UI_DIR=/app/ui/dist \
    HEAT_SHUTDOWN=0 \
    POWEROFF_CMD=
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
EXPOSE 8080
USER node
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--disable-warning=ExperimentalWarning", "brain/dist/index.js"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
