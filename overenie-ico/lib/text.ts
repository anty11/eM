/** Textové pomôcky bez závislostí na serveri – použiteľné aj v prehliadači (klientske komponenty). */
export function fold(s: string): string {
  return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
