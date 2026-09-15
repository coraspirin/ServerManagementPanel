import { CloudRain, CloudSnow, Cloudy, Sun, Zap } from "lucide-react";
import type { Weather } from "@/lib/home/weather";

/**
 * İkonu BİLEŞEN olarak değil, hazır ELEMAN olarak döndürüyor.
 *
 * `const Icon = icon(code)` biçimi render sırasında bileşen üretmek sayılıyor
 * (react-hooks/static-components): React her render'da yeni bir bileşen türü
 * görür ve alt ağacın durumunu sıfırlar.
 */
function WeatherIcon({ code, className }: { code: number; className: string }) {
  if (code === 0 || code <= 2) return <Sun className={className} aria-hidden />;
  if (code <= 48) return <Cloudy className={className} aria-hidden />;
  if (code <= 67 || (code >= 80 && code <= 82))
    return <CloudRain className={className} aria-hidden />;
  if (code <= 86) return <CloudSnow className={className} aria-hidden />;
  return <Zap className={className} aria-hidden />;
}

/** M2.7 — hava durumu kutusu. */
export function WeatherCard({
  weather,
  label,
  big = false,
}: {
  weather: Weather;
  label: string;
  big?: boolean;
}) {
  return (
    <div className="flex items-center gap-4">
      <WeatherIcon
        code={weather.code}
        className={`shrink-0 text-brand ${big ? "size-12" : "size-8"}`}
      />
      <div className="min-w-0">
        <div className={`font-semibold tabular-nums ${big ? "text-4xl" : "text-2xl"}`}>
          {Math.round(weather.temperature)}°
        </div>
        <div className={`text-subtle ${big ? "text-base" : "text-xs"}`}>
          {weather.description}
          {label && ` · ${label}`}
        </div>
        <div className={`text-subtle ${big ? "text-sm" : "text-[11px]"}`}>
          {/* Hissedilen ayrı yazılıyor: rüzgârlı bir günde 12° ile 6° arasındaki
              fark, dışarı çıkarken giyilecek şeyi değiştiriyor. */}
          Hissedilen {Math.round(weather.apparent)}° · En yüksek{" "}
          {Math.round(weather.max)}° / en düşük {Math.round(weather.min)}°
        </div>
      </div>
    </div>
  );
}
