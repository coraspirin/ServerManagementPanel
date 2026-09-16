"use client";

import { useEffect, useRef, useState } from "react";
import { Bold, Italic, Link2, List, ListOrdered, Pencil, Underline } from "lucide-react";
import { Modal } from "@/components/Modal";
import { isRichTextEmpty, richTextToPlain, sanitizeRichText } from "@/lib/richtext";
import { useT } from "@/lib/i18n/client";
import { Rich } from "@/lib/i18n/rich";

/**
 * Biçimlendirilmiş metin alanı (M3.45).
 *
 * ## Neden popup
 *
 * Ayar satırları tek satırlık kutular için tasarlanmış; duyuru ise birkaç
 * cümle ve bazen bir bağlantı. Satırın içine gömülü bir düzenleyici hem
 * listeyi bozuyor hem de yazarken ne yazdığını görmeyi zorlaştırıyordu.
 * Satırda ÖNİZLEME duruyor, düzenleme ayrı pencerede.
 *
 * ## Neden `contentEditable` + `execCommand`, kütüphane değil
 *
 * Panelin hiçbir yerinde zengin metin yok; tek bir duyuru alanı için
 * projeye editör kütüphanesi (ve onun CSS'i, eklenti sistemi, sürüm bakımı)
 * girmek orantısız. `document.execCommand` resmen "deprecated" ama kalın/
 * italik/liste için hâlâ her tarayıcıda çalışıyor ve yerini alan standart
 * yok. Çıktı her durumda [sanitizeRichText](../../lib/richtext.ts)'ten
 * geçtiği için üretilen HTML'in ne kadar dağınık olduğu önemli değil.
 *
 * KAYDET'e basılmadan hiçbir şey gönderilmiyor: ayar ekranının geri kalanı
 * odaktan çıkınca kaydediyor ama burada yazarken odağın kutudan çıkması
 * (araç çubuğuna tıklamak) normal bir hareket.
 */

type Command = {
  id: string;
  label: string;
  icon: typeof Bold;
  run: () => void;
};

function exec(command: string, value?: string) {
  document.execCommand(command, false, value);
}

export function RichTextField({
  value,
  disabled,
  onCommit,
  title: titleProp,
}: {
  value: string;
  disabled: boolean;
  onCommit: (value: string) => void;
  title?: string;
}) {
  const t = useT();
  const title = titleProp ?? t("richText.edit");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Pencere açılınca kutunun içeriği BİR KEZ yazılıyor. React'in her render'da
  // yeniden yazması imleci her tuşta başa atardı — `contentEditable` ile
  // kontrollü bileşen kalıbı çalışmıyor.
  useEffect(() => {
    if (!open) return;
    const box = boxRef.current;
    if (box) box.innerHTML = sanitizeRichText(value);
  }, [open, value]);

  const preview = richTextToPlain(value);

  const commands: Command[] = [
    { id: "bold", label: t("richText.bold"), icon: Bold, run: () => exec("bold") },
    { id: "italic", label: t("richText.italic"), icon: Italic, run: () => exec("italic") },
    {
      id: "underline",
      label: t("richText.underline"),
      icon: Underline,
      run: () => exec("underline"),
    },
    {
      id: "ul",
      label: t("richText.bulletList"),
      icon: List,
      run: () => exec("insertUnorderedList"),
    },
    {
      id: "ol",
      label: t("richText.numberedList"),
      icon: ListOrdered,
      run: () => exec("insertOrderedList"),
    },
    {
      id: "link",
      label: t("richText.link"),
      icon: Link2,
      run: () => {
        const href = prompt(t("richText.linkPrompt"));
        if (href) exec("createLink", href);
      },
    },
  ];

  return (
    <div className="flex w-full items-start gap-1.5 sm:w-72">
      <div
        className="min-w-0 flex-1 rounded-md border border-line bg-canvas px-2 py-1.5 text-sm"
        title={preview}
      >
        {preview ? (
          <span className="line-clamp-2 break-words">{preview}</span>
        ) : (
          <span className="text-subtle">{t("richText.empty")}</span>
        )}
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        title={title}
        className="shrink-0 rounded-md border border-line p-1.5 text-subtle transition-colors hover:border-brand hover:text-brand disabled:opacity-50"
      >
        <Pencil className="size-4" />
      </button>

      <Modal open={open} title={title} onClose={() => setOpen(false)} wide>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1 rounded-md border border-line bg-canvas px-1.5 py-1">
            {commands.map((command) => (
              <button
                key={command.id}
                type="button"
                title={command.label}
                aria-label={command.label}
                /*
                  `onMouseDown` + preventDefault: `onClick` kullanılsaydı
                  düğmeye basmak önce kutudan odağı alır, seçim kaybolur ve
                  komut hiçbir şeye uygulanmazdı.
                */
                onMouseDown={(e) => {
                  e.preventDefault();
                  command.run();
                }}
                className="rounded p-1.5 text-subtle transition-colors hover:bg-line/50 hover:text-ink"
              >
                <command.icon className="size-4" />
              </button>
            ))}
          </div>

          <div
            ref={boxRef}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label={title}
            className="prose-notice min-h-40 max-h-80 overflow-y-auto rounded-md border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand"
          />

          <p className="text-xs text-subtle">
            <Rich
              text={t("richText.help")}
              values={{ strong: <strong>{t("richText.everyone")}</strong> }}
            />
          </p>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-subtle transition-colors hover:text-ink"
            >
              {t("common.actions.cancel")}
            </button>
            <button
              type="button"
              onClick={() => {
                const raw = boxRef.current?.innerHTML ?? "";
                const clean = sanitizeRichText(raw);
                // Görünür içerik kalmadıysa boş dize: karşılama sayfası
                // "boşsa şerit çizme" kuralını `<p><br></p>` ile bozmasın.
                onCommit(isRichTextEmpty(clean) ? "" : clean);
                setOpen(false);
              }}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              {t("common.actions.save")}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
