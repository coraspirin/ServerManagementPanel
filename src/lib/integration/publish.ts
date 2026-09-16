import "server-only";
import { serverT } from "@/lib/i18n/runtime";

import { getBool, getNumber, getString } from "@/lib/settings";
import { mqttPublish, type MqttConfig, type MqttMessage } from "./mqtt";
import { collectSamples, type Sample } from "./state";

/**
 * M3.11 — MQTT yayını.
 *
 * Neden değerli: sunucuda zaten bir Mosquitto ve bir Home Assistant çalışıyor.
 * Panel metriklerini MQTT'ye basınca otomasyon HA tarafında yazılabilir hale
 * geliyor — "disk %90'ı geçerse ışığı kırmızı yak" gibi şeyler için panelin
 * kendi kural motoruna gerek kalmıyor.
 */

export function mqttConfigured(): boolean {
  return getBool("integration.mqtt.enabled") && getString("integration.mqtt.host").trim() !== "";
}

export function mqttConfig(): MqttConfig {
  return {
    host: getString("integration.mqtt.host").trim(),
    port: getNumber("integration.mqtt.port"),
    username: getString("integration.mqtt.username"),
    password: getString("integration.mqtt.password"),
    clientId: getString("integration.mqtt.client_id") || "sunucu-paneli",
    tls: getBool("integration.mqtt.tls"),
    timeoutMs: getNumber("integration.mqtt.timeout_seconds") * 1000,
  };
}

function baseTopic(): string {
  return (getString("integration.mqtt.base_topic") || "panel").replace(/\/+$/, "");
}

/** Konu parçasında `/`, `+`, `#` ve boşluk sorun çıkarır. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

/** Bir örneğin konusu: `panel/metric/<ad>` ya da etiketliyse `.../<etiket>`. */
function topicFor(sample: Sample): string {
  const name = sample.name.replace(/^panel_/, "");
  const label = Object.values(sample.labels)[0];
  return label
    ? `${baseTopic()}/metric/${slugify(name)}/${slugify(label)}`
    : `${baseTopic()}/metric/${slugify(name)}`;
}

/**
 * Metrikleri yayınlar.
 *
 * `retain` AÇIK: MQTT'de saklanmayan bir mesajı, o an dinlemeyen abone hiç
 * görmez. HA yeniden başladığında panelin bir sonraki turunu (dakikalar
 * sonra) beklemek yerine son değeri hemen alsın diye durum konuları saklanır.
 */
export async function publishMetrics(): Promise<{ published: number; topics: number }> {
  const samples = await collectSamples();
  const messages: MqttMessage[] = samples.map((sample) => ({
    topic: topicFor(sample),
    payload: String(sample.value),
    retain: true,
    qos: 0,
  }));

  // Tek bir birleşik JSON da basılıyor: tek tek konulara abone olmak yerine
  // hepsini bir kerede isteyen istemciler için (ve HA'nın `value_template`'i
  // bunu doğrudan kullanabiliyor).
  messages.push({
    topic: `${baseTopic()}/state`,
    payload: JSON.stringify(
      Object.fromEntries(
        samples.map((sample) => {
          const label = Object.values(sample.labels)[0];
          const key = sample.name.replace(/^panel_/, "") + (label ? `_${slugify(label)}` : "");
          return [key, sample.value];
        }),
      ),
    ),
    retain: true,
    qos: 0,
  });

  const result = await mqttPublish(mqttConfig(), messages);
  return { published: result.published, topics: messages.length };
}

/**
 * Tek bir olayı yayınlar.
 *
 * `retain` KAPALI: olaylar akıştır, durum değil. Saklansaydı MQTT'ye yeni
 * bağlanan her istemci geçmiş bir arızayı yeni olmuş gibi görürdü.
 */
export async function publishEvent(event: {
  severity: string;
  source: string;
  alertKey: string;
  title: string;
  detail: string;
  ts: number;
}): Promise<void> {
  if (!mqttConfigured() || !getBool("integration.mqtt.publish_events")) return;

  await mqttPublish(mqttConfig(), [
    {
      topic: `${baseTopic()}/event/${slugify(event.source)}`,
      payload: JSON.stringify(event),
      retain: false,
      qos: 0,
    },
  ]);
}

/** Otomasyon eyleminden gelen serbest yayın. */
export async function publishRaw(topic: string, payload: string, retain: boolean): Promise<void> {
  await mqttPublish(mqttConfig(), [{ topic, payload, retain, qos: 0 }]);
}

/**
 * Home Assistant MQTT otomatik keşfi.
 *
 * HA, `homeassistant/sensor/<id>/config` konusunda saklanmış bir tanım
 * görürse entity'yi kendisi oluşturur. Bu, iptal edilen M3.12'nin (panelden
 * HA entity yönetimi) yerini KISMEN dolduruyor: yön ters — panel HA'ya bir
 * şey sormuyor, kendi verisini HA'nın anlayacağı biçimde ortaya koyuyor.
 * Bağımlılık yok, HA token'ı gerekmiyor, HA kapalıyken de çalışıyor.
 *
 * Yalnızca ETİKETSİZ metrikler ilan ediliyor: her container ve her monitör
 * için entity üretmek, HA'yı panelin iç ayrıntısıyla doldurmak olurdu.
 */
export async function publishDiscovery(): Promise<{ announced: number }> {
  const samples = (await collectSamples()).filter(
    (sample) => Object.keys(sample.labels).length === 0,
  );
  const prefix = getString("integration.mqtt.discovery_prefix") || "homeassistant";
  const base = baseTopic();

  const messages: MqttMessage[] = samples.map((sample) => {
    const key = sample.name.replace(/^panel_/, "");
    return {
      topic: `${prefix}/sensor/${base}_${slugify(key)}/config`,
      payload: JSON.stringify({
        name: sample.help,
        unique_id: `${base}_${slugify(key)}`,
        state_topic: `${base}/state`,
        value_template: `{{ value_json.${key} }}`,
        unit_of_measurement: sample.unit,
        // Tüm sensörler tek bir "cihaz" altında toplanıyor; aksi halde HA'da
        // otuz ayrı cihaz görünürdü.
        device: {
          identifiers: [base],
          name: "Sunucu Paneli", // i18n-ignore — Home Assistant cihaz adı, dil değişince değişmemeli
          manufacturer: serverT("common.appName"),
        },
      }),
      retain: true,
      qos: 0,
    };
  });

  await mqttPublish(mqttConfig(), messages);
  return { announced: messages.length };
}

/** Keşif ilanlarını geri alır — boş saklanmış mesaj, HA'da entity'yi siler. */
export async function clearDiscovery(): Promise<{ cleared: number }> {
  const samples = (await collectSamples()).filter(
    (sample) => Object.keys(sample.labels).length === 0,
  );
  const prefix = getString("integration.mqtt.discovery_prefix") || "homeassistant";
  const base = baseTopic();

  const messages: MqttMessage[] = samples.map((sample) => ({
    topic: `${prefix}/sensor/${base}_${slugify(sample.name.replace(/^panel_/, ""))}/config`,
    payload: "",
    retain: true,
    qos: 0,
  }));

  await mqttPublish(mqttConfig(), messages);
  return { cleared: messages.length };
}
