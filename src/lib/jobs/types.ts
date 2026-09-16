export type JobResult = {
  /** Panel İşleri ekranında ve job_runs kaydında görünen kısa özet. */
  detail?: string;
};

export type JobDefinition = {
  key: string;
  /**
   * Zamanlama.
   *
   * `cron` / `interval`: değer AYARDAN okunur, koda yazılmaz (T2/T9) —
   * kullanıcının umursadığı her sıklık böyledir.
   *
   * `fixed`: işin kendi iç tarama temposu; kullanıcıya sunulacak bir tercih
   * değil. Örnek: servis izleme işi her monitörün kendi aralığını `monitors`
   * tablosunda tutar, iş yalnızca "zamanı gelen var mı" diye bakar. Bunu ayara
   * bağlamak anlamsız bir düğme üretirdi.
   */
  schedule:
    | { kind: "cron"; settingKey: string }
    | { kind: "interval"; settingKey: string }
    /** `labelKey` sözlükteki sıklık metni; işin ADI da sözlükte (`jobs.items`). */
    | { kind: "fixed"; seconds: number; labelKey: string };
  /** Kira süresi: işin en fazla ne kadar süreceği tahmini (saniye). */
  leaseSeconds?: number;
  /**
   * Başarılı çalışmalar `job_runs` geçmişine yazılsın mı? (varsayılan: evet)
   *
   * Saniyeler aralıkla çalışan işlerde kapatılır: 50 satırlık geçmiş yalnızca
   * son birkaç dakikayı kapsar ve hiçbir işe yaramaz. Hatalar her durumda
   * yazılır — asıl görmek istediğimiz onlar.
   */
  recordSuccessRuns?: boolean;
  run: () => Promise<JobResult | void>;
};

export type JobStatusRow = {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  /** Ekran, cron ifadesini insan diline çevirmeli mi bilsin diye. */
  scheduleKind: "cron" | "interval" | "fixed";
  scheduleText: string;
  lastRunAt: number | null;
  lastFinishAt: number | null;
  lastDurationMs: number | null;
  lastStatus: string;
  lastError: string | null;
  nextRunAt: number | null;
  runCount: number;
  failCount: number;
};
