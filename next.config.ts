import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Container imajı için: bağımlılıkları izleyip tek başına çalışabilir
  // bir sunucu üretir (node_modules'ün tamamını kopyalamaya gerek kalmaz).
  output: "standalone",

  // Panel reverse proxy (Caddy) arkasında çalışır; gerçek istemci IP'si
  // X-Forwarded-* başlıklarından gelir — rate limit ve audit için gerekli (T6).
  poweredByHeader: false,
};

export default nextConfig;
