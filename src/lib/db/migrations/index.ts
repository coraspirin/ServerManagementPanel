import { migration001 } from "./001_foundation";
import { migration002 } from "./002_auth";
import { migration003 } from "./003_settings";
import { migration004 } from "./004_jobs";
import { migration005 } from "./005_monitors";
import { migration006 } from "./006_alerts";
import { migration007 } from "./007_runbooks";
import { migration008 } from "./008_cache";
import { migration009 } from "./009_launcher";
import { migration010 } from "./010_home";
import { migration011 } from "./011_proxy";
import { migration012 } from "./012_network";
import { migration013 } from "./013_users";
import { migration014 } from "./014_logs";
import { migration015 } from "./015_backup";
import { migration016 } from "./016_dbadmin";
import { migration017 } from "./017_security";
import { migration018 } from "./018_appstore";
import { migration019 } from "./019_automation";
import { migration020 } from "./020_dashboard";
import { migration021 } from "./021_appstore_sources";
import { migration022 } from "./022_drop_automation";
import { migration023 } from "./023_host_console";
import { migration024 } from "./024_login_apps";
import { migration025 } from "./025_api_tokens";
import type { Migration } from "./types";

/**
 * Migration'lar TS modülü olarak tutuluyor, ayrı .sql dosyaları olarak değil.
 * Sebebi: Next standalone çıktısı yalnızca izlediği dosyaları kopyalar;
 * runtime'da okunan .sql dosyaları imajda eksik kalıp üretimde patlayabilir.
 * TS modülü derlemeye dahil olduğu için bu sınıf hata mümkün değil.
 */
export const migrations: Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
  migration007,
  migration008,
  migration009,
  migration010,
  migration011,
  migration012,
  migration013,
  migration014,
  migration015,
  migration016,
  migration017,
  migration018,
  migration019,
  migration020,
  migration021,
  migration022,
  migration023,
  migration024,
  migration025,
];

export type { Migration };
