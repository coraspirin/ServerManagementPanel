export type Migration = {
  /** 1'den başlayan, boşluksuz artan sıra numarası. */
  version: number;
  /** Kısa ad — log ve yedek dosya adında görünür. */
  name: string;
  /** Tek seferde çalıştırılacak SQL. İşlem (transaction) runner tarafından açılır. */
  up: string;
};
