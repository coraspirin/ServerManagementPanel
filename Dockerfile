# syntax=docker/dockerfile:1

# Alpine/musl DEĞİL: ileride gelecek native modüller (better-sqlite3 M0.3,
# node-pty M1.9) glibc üzerinde çok daha sorunsuz derleniyor.
#
# Derleme YAPI makinesinin mimarisinde ($BUILDPLATFORM), tek sefer yapılıyor:
# Next'in standalone çıktısı saf JavaScript ve çalışma zamanı bağımlılıklarında
# native modül yok, yani aynı çıktı her mimaride çalışıyor. Hem arm derlemesi
# QEMU emülasyonundan kurtuluyor hem de 32-bit ARM (Raspberry Pi / DietPi,
# panel-agent) mümkün oluyor: Node 24'ün linux/arm/v7 imajı yok.
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1

# ---------- bağımlılıklar ----------
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------- derleme ----------
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG APP_VERSION=1.11.3
ENV APP_VERSION=${APP_VERSION}
RUN npm run build

# ---------- çalıştırma ----------
# Hedef mimariye göre Node: 64-bit'te 24, 32-bit ARM'da (arm/v7) 22 — Node 24
# o mimariyi bırakıyor. Kod Node 22'de olmayan bir API kullanmıyor; node:sqlite
# 22.13'ten beri bayraksız.
FROM node:24-bookworm-slim AS runtime-amd64
FROM node:24-bookworm-slim AS runtime-arm64
FROM node:22-bookworm-slim AS runtime-arm
FROM runtime-${TARGETARCH} AS runner
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 panel \
 && useradd --system --uid 1001 --gid panel panel

# ping monitörü (M1.2) için. Node'un ham soket API'si yok, ICMP ancak harici
# komutla atılabiliyor. Debian'ın ping ikilisi `cap_net_raw+ep` dosya
# yetkisiyle geliyor; Docker varsayılan yetki kümesi CAP_NET_RAW içerdiği için
# root olmayan kullanıcıyla da çalışır.
RUN apt-get update \
 && apt-get install -y --no-install-recommends iputils-ping openssl \
 && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/public ./public
COPY --from=builder --chown=panel:panel /app/.next/standalone ./
COPY --from=builder --chown=panel:panel /app/.next/static ./.next/static

# MOCK_MODE (T10) sunucuda da açılabilsin diye fixture'lar imaja giriyor:
# gerçek veri kaynağı bozulduğunda paneli sahte veriyle ayağa kaldırıp
# sorunun UI'da mı yoksa entegrasyonda mı olduğunu ayırt edebilmek için.
COPY --from=builder --chown=panel:panel /app/fixtures ./fixtures

# Rol seçen giriş noktası (merkez / panel-agent). Standalone çıktı onu
# izlemediği için ayrıca kopyalanıyor. openssl (yukarıda) panel-agent'ın
# ilk açılışta kendi TLS sertifikasını üretmesi için.
COPY --from=builder --chown=panel:panel /app/scripts/docker-entry.mjs ./docker-entry.mjs

# SQLite ve migration kopyaları buraya (M0.3) — compose'da volume bağlanır.
# Dizinler İMAJDA oluşturuluyor ki boş bir named volume ilk bağlandığında
# sahipliği buradan devralsın. Yalnızca compose'da mount edilseydi volume
# root'a ait olurdu ve panel (uid 1001) içine yazamazdı — M2.8'de tam olarak
# bu yaşandı: Caddy yapılandırması yazılamayınca yayınlama ucu 500 döndü.
RUN mkdir -p /app/data /app/proxy && chown panel:panel /app/data /app/proxy

USER panel
EXPOSE 3000
# panel-agent (PANEL_ROLE=agent) HTTPS portu.
EXPOSE 7443

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "docker-entry.mjs"]
