import "server-only";

import net from "node:net";
import tls from "node:tls";
import { currentDictionary, serverT } from "@/lib/i18n/runtime";
import { translateLoose } from "@/lib/i18n/translate";

/**
 * M3.11 — minimal MQTT 3.1.1 yayıncısı.
 *
 * BAĞIMLILIK EKLENMEDİ. Panelin ihtiyacı tek yönlü: bağlan, birkaç mesaj
 * yayınla, kapat. `mqtt` paketi bunun yanında abonelik, oturum kalıcılığı,
 * otomatik yeniden bağlanma, WebSocket taşıması ve kendi paket kuyruğunu
 * getiriyor — hiçbiri kullanılmayacak koddur. Redis sürücüsünde (M3.6) aynı
 * gerekçeyle RESP elle yazılmıştı.
 *
 * KAPSAM, açıkça: yalnızca CONNECT / PUBLISH / DISCONNECT. Abonelik yok, QoS 2
 * yok. QoS 1 destekleniyor çünkü "mesaj gitti mi" sorusunun cevabı retained
 * durum konularında gerçekten önemli; QoS 2'nin dört adımlı el sıkışması ise
 * metrik yayınlamak için fazla.
 */

export type MqttConfig = {
  host: string;
  port: number;
  username: string;
  password: string;
  clientId: string;
  tls: boolean;
  timeoutMs: number;
};

export type MqttMessage = {
  topic: string;
  payload: string;
  /** Broker mesajı saklasın mı — durum konuları için açık, olaylar için kapalı. */
  retain?: boolean;
  qos?: 0 | 1;
};

/**
 * MQTT'nin değişken uzunluk kodlaması: her baytın alt 7 biti veri, en üst
 * biti "devam ediyor" bayrağı. Paket gövdesinin uzunluğu böyle taşınır.
 */
function encodeLength(value: number): number[] {
  const bytes: number[] = [];
  let remaining = value;
  do {
    let byte = remaining % 128;
    remaining = Math.floor(remaining / 128);
    if (remaining > 0) byte |= 0x80;
    bytes.push(byte);
  } while (remaining > 0);
  return bytes;
}

/** UTF-8 dizgi: 2 baytlık uzunluk öneki + içerik. */
function encodeString(value: string): Buffer {
  const body = Buffer.from(value, "utf8");
  const header = Buffer.alloc(2);
  header.writeUInt16BE(body.length, 0);
  return Buffer.concat([header, body]);
}

function packet(type: number, flags: number, body: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from([(type << 4) | flags, ...encodeLength(body.length)]),
    body,
  ]);
}

function connectPacket(config: MqttConfig): Buffer {
  // Bağlantı bayrakları: temiz oturum (0x02) + varsa kullanıcı adı/parola.
  let flags = 0x02;
  if (config.username) flags |= 0x80;
  if (config.password) flags |= 0x40;

  const keepAlive = Buffer.alloc(2);
  // 60 sn: panel bağlantıyı saniyeler içinde kapatıyor, PINGREQ hiç gerekmiyor.
  keepAlive.writeUInt16BE(60, 0);

  const parts = [
    encodeString("MQTT"),
    Buffer.from([0x04, flags]), // protokol seviyesi 4 = MQTT 3.1.1
    keepAlive,
    encodeString(config.clientId),
  ];
  if (config.username) parts.push(encodeString(config.username));
  if (config.password) parts.push(encodeString(config.password));

  return packet(1, 0, Buffer.concat(parts));
}

function publishPacket(message: MqttMessage, packetId: number): Buffer {
  const qos = message.qos ?? 0;
  const flags = (qos << 1) | (message.retain ? 1 : 0);

  const parts = [encodeString(message.topic)];
  if (qos > 0) {
    const id = Buffer.alloc(2);
    id.writeUInt16BE(packetId, 0);
    parts.push(id);
  }
  parts.push(Buffer.from(message.payload, "utf8"));

  return packet(3, flags, Buffer.concat(parts));
}

/** CONNACK dönüş kodları — "bağlanamadı" demek yerine sebebini söylemek için. */
/** CONNACK dönüş kodlarının açıklaması — `mqtt.connack.<kod>` (dil dosyası). */
function connackError(code: number): string {
  const key = `mqtt.connack.${code}`;
  const dict = currentDictionary();
  return dict[key] === undefined
    ? serverT("mqtt.rejected", { code })
    : translateLoose(dict, key);
}

/**
 * Tek bağlantıda birden çok mesaj yayınlar.
 *
 * Mesaj başına bağlantı açmıyoruz: 40 metrik yayınlamak 40 TCP el sıkışması
 * demek olurdu ve broker günlüğü bağlantı gürültüsüyle dolardı.
 */
export function mqttPublish(
  config: MqttConfig,
  messages: MqttMessage[],
): Promise<{ published: number }> {
  return new Promise((resolve, reject) => {
    if (messages.length === 0) {
      resolve({ published: 0 });
      return;
    }

    // TLS SINIRI, açıkça: ev kurulumlarındaki broker'lar neredeyse her zaman
    // kendinden imzalı sertifika taşır ve zincir doğrulaması bu yüzden kapalı.
    // Yani buradaki TLS trafiği ŞİFRELER ama broker'ın kimliğini DOĞRULAMAZ —
    // aynı ağda araya girebilen biri broker taklidi yapabilir. LAN içinde düz
    // TCP ile arasındaki fark budur ve ayar yardımında da yazılıdır.
    const socket = config.tls
      ? tls.connect({ host: config.host, port: config.port, rejectUnauthorized: false })
      : net.createConnection({ host: config.host, port: config.port });

    let settled = false;
    const finish = (error: Error | null, published = 0) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve({ published });
    };

    socket.setTimeout(config.timeoutMs);
    socket.on("timeout", () => finish(new Error(serverT("mqtt.timeout"))));
    socket.on("error", (error) => finish(error));

    // QoS 1 kullanılan mesajlar için beklenen PUBACK sayısı.
    const acked = new Set<number>();
    const needAck = messages.filter((message) => (message.qos ?? 0) > 0).length;

    socket.on(config.tls ? "secureConnect" : "connect", () => {
      socket.write(connectPacket(config));
    });

    let buffer = Buffer.alloc(0);

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      while (buffer.length >= 2) {
        const type = buffer[0] >> 4;
        // Gelen paketlerin (CONNACK 4 bayt, PUBACK 4 bayt) uzunluğu tek bayta
        // sığar; çok baytlı uzunluk çözümlemesine gerek yok.
        const remaining = buffer[1];
        if (buffer.length < remaining + 2) return;

        const body = buffer.subarray(2, remaining + 2);
        buffer = buffer.subarray(remaining + 2);

        if (type === 2) {
          const code = body[1];
          if (code !== 0) {
            finish(new Error(connackError(code)));
            return;
          }

          let packetId = 1;
          for (const message of messages) {
            socket.write(publishPacket(message, packetId));
            if ((message.qos ?? 0) > 0) packetId += 1;
          }

          // Hiçbiri onay beklemiyorsa DISCONNECT yazıp bitiriyoruz. Yazma
          // tamamlanmadan soketi kapatmak son mesajları düşürebilirdi, bu
          // yüzden kapatma write geri çağrısında.
          if (needAck === 0) {
            socket.write(packet(14, 0, Buffer.alloc(0)), () => {
              finish(null, messages.length);
            });
          }
        } else if (type === 4) {
          acked.add(body.readUInt16BE(0));
          if (acked.size >= needAck) {
            socket.write(packet(14, 0, Buffer.alloc(0)), () => {
              finish(null, messages.length);
            });
          }
        }
      }
    });
  });
}
