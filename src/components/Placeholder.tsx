import { Construction } from "lucide-react";

type Props = {
  milestone: string;
  title: string;
  description: string;
};

/**
 * Henüz yapılmamış ekranlar için yer tutucu. Hangi milestone'un bu ekranı
 * getireceğini gösterir, böylece yol haritası uygulamanın içinden görünür olur.
 */
export function Placeholder({ milestone, title, description }: Props) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center rounded-lg border border-dashed border-line bg-surface px-6 py-12 text-center">
      <Construction className="size-7 text-subtle" aria-hidden />
      <span className="mt-3 rounded bg-brand/10 px-2 py-0.5 font-mono text-xs font-medium text-brand">
        {milestone}
      </span>
      <h2 className="mt-3 font-semibold">{title}</h2>
      <p className="mt-1.5 text-sm text-subtle">{description}</p>
    </div>
  );
}
