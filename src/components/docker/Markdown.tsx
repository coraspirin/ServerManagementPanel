import { Fragment } from "react";

/**
 * Runbook notları için küçük bir markdown görüntüleyici (M1.8).
 *
 * Kütüphane eklenmedi ve `dangerouslySetInnerHTML` KULLANILMIYOR: çıktı React
 * düğümü olarak kuruluyor, dolayısıyla nota yazılan bir `<script>` metin
 * olarak kalır. Bu notu panele erişimi olan herkes yazabildiği için, HTML
 * enjeksiyonu yüzeyini hiç açmamak en ucuz güvenlik kararıydı.
 *
 * Desteklenen: `#`/`##`/`###` başlık, `-`/`*` madde, `1.` numaralı madde,
 * ```` ``` ```` blok kodu, satır içi `` `kod` ``, **kalın**. Gerisi düz metin
 * olarak görünür — markdown'ın tamamını desteklemek amaç değil, gece 3'te
 * okunan bir notu okunabilir kılmak amaç.
 */

function inline(text: string, keyPrefix: string) {
  // Satır içi kod ve kalın: tek geçişte, iç içe geçmeyi denemeden.
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={key} className="rounded bg-line/60 px-1 py-0.5 font-mono text-[0.9em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={key} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];

  let listItems: { text: string; ordered: boolean }[] = [];
  let codeLines: string[] | null = null;
  let paragraph: string[] = [];

  const flushList = () => {
    if (listItems.length === 0) return;
    const ordered = listItems[0].ordered;
    const items = listItems.map((item, index) => (
      <li key={index}>{inline(item.text, `li-${blocks.length}-${index}`)}</li>
    ));
    blocks.push(
      ordered ? (
        <ol key={`b${blocks.length}`} className="ml-5 list-decimal space-y-0.5">
          {items}
        </ol>
      ) : (
        <ul key={`b${blocks.length}`} className="ml-5 list-disc space-y-0.5">
          {items}
        </ul>
      ),
    );
    listItems = [];
  };

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join(" ");
    blocks.push(<p key={`b${blocks.length}`}>{inline(text, `p-${blocks.length}`)}</p>);
    paragraph = [];
  };

  const flushAll = () => {
    flushParagraph();
    flushList();
  };

  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      if (codeLines === null) {
        flushAll();
        codeLines = [];
      } else {
        blocks.push(
          <pre
            key={`b${blocks.length}`}
            className="overflow-x-auto rounded border border-line bg-canvas p-2 font-mono text-[11px]"
          >
            {codeLines.join("\n")}
          </pre>,
        );
        codeLines = null;
      }
      continue;
    }

    if (codeLines !== null) {
      codeLines.push(line);
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      const size = level === 1 ? "text-base" : level === 2 ? "text-sm" : "text-xs";
      blocks.push(
        <p key={`b${blocks.length}`} className={`${size} font-semibold`}>
          {inline(heading[2], `h-${blocks.length}`)}
        </p>,
      );
      continue;
    }

    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = numbered !== null;
      // Liste türü değişirse önceki liste kapanır; yoksa madde işaretli ve
      // numaralı maddeler tek listede karışırdı.
      if (listItems.length > 0 && listItems[0].ordered !== ordered) flushList();
      listItems.push({ text: (bullet ?? numbered)![1], ordered });
      continue;
    }

    if (line.trim() === "") {
      flushAll();
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  // Kapanmamış bir kod bloğu sessizce yutulmasın.
  if (codeLines !== null) {
    blocks.push(
      <pre
        key={`b${blocks.length}`}
        className="overflow-x-auto rounded border border-line bg-canvas p-2 font-mono text-[11px]"
      >
        {codeLines.join("\n")}
      </pre>,
    );
  }
  flushAll();

  return <div className="space-y-2 text-sm leading-relaxed">{blocks}</div>;
}
