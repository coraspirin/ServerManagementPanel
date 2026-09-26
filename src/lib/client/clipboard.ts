/**
 * Metni panoya kopyalar; başarılıysa true.
 *
 * `navigator.clipboard` yalnızca güvenli bağlamda (HTTPS ya da localhost)
 * var — panel çoğu kurulumda `http://ip:port` ile açılıyor ve orada API
 * hiç tanımlı değil. O durumda eski `execCommand("copy")` yoluna düşülür.
 *
 * Geçici textarea, açık bir modal `<dialog>` varsa ONUN içine konur: modal
 * açıkken sayfanın geri kalanı `inert`, dışarıdaki bir alan seçilemez ve
 * kopyalama sessizce boş döner.
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // İzin reddedildi — aşağıdaki yola düş.
    }
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  if (typeof document === "undefined") return false;
  const host = document.querySelector("dialog[open]") ?? document.body;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "0";
  area.style.opacity = "0";
  area.style.pointerEvents = "none";
  const focused = document.activeElement as HTMLElement | null;
  host.appendChild(area);
  area.select();
  area.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  focused?.focus?.();
  return ok;
}
