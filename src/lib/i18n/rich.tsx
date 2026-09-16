/**
 * Cümle içinde biçimli parça — kalın bir başlık, `font-mono` bir komut, bir
 * bağlantı.
 *
 * Cümle TEK bir çeviri metni olarak kalıyor ve biçimli parçanın yeri yer
 * tutucuyla işaretleniyor:
 *
 *   "network.connectHelp": "… bir sonraki {cmd} bunu geri alır …"
 *   <Rich text={t("docker.network.connectHelp")} values={{ cmd: <code>compose up</code> }} />
 *
 * Cümleyi "öncesi / komut / sonrası" diye üç anahtara bölmek, kelime sırası
 * farklı bir dilde parçaları yanlış sıraya sokardı; yer tutucu ise çevirmenin
 * cümle içinde istediği yere konabiliyor.
 *
 * Kanca kullanmıyor: hem sunucu hem istemci bileşenlerinde çalışır.
 */

import { Fragment, type ReactNode } from "react";
import { PLACEHOLDER } from "./translate.ts";

export function Rich({ text, values }: { text: string; values: Record<string, ReactNode> }) {
  const parts: ReactNode[] = [];
  let last = 0;

  for (const match of text.matchAll(PLACEHOLDER)) {
    const [whole, name] = match;
    const index = match.index ?? 0;
    if (index > last) parts.push(text.slice(last, index));
    parts.push(
      name in values ? <Fragment key={`${name}-${index}`}>{values[name]}</Fragment> : whole,
    );
    last = index + whole.length;
  }
  if (last < text.length) parts.push(text.slice(last));

  return <>{parts}</>;
}
