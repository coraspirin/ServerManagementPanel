/**
 * English dictionary.
 *
 * The `Dictionary` annotation is the guarantee: this object must have exactly
 * the same shape as the Turkish one, or the build fails.
 */

import type { Dictionary } from "../tr/index.ts";
import { alerts } from "./alerts.ts";
import { auth } from "./auth.ts";
import { common } from "./common.ts";
import { help } from "./help.ts";
import { jobs } from "./jobs.ts";
import { metrics } from "./metrics.ts";
import { nav } from "./nav.ts";
import { settings } from "./settings.ts";
import { shell } from "./shell.ts";

export const en: Dictionary = {
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
