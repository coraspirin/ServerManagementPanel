/**
 * Türkçe sözlük — panelin KAYNAK dili.
 *
 * Yeni ad alanı eklerken: `dict/tr/<ad>.ts` yaz, buraya ekle, sonra
 * `dict/en/<ad>.ts` ile İngilizcesini ver. İkincisini unutursan typecheck
 * hatırlatır.
 */

import { alerts } from "./alerts.ts";
import { auth } from "./auth.ts";
import { common } from "./common.ts";
import { help } from "./help.ts";
import { jobs } from "./jobs.ts";
import { metrics } from "./metrics.ts";
import { nav } from "./nav.ts";
import { settings } from "./settings.ts";
import { shell } from "./shell.ts";

export const tr = {
  alerts,
  auth,
  common,
  help,
  jobs,
  metrics,
  nav,
  settings,
  shell,
};

/** Tüm sözlüğün tipi. Anahtar denetimi ve İngilizce dosyalar buna dayanıyor. */
export type Dictionary = typeof tr;
