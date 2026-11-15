import { tidy } from "./clean";

const BLOCKS = "p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,dt,dd,figcaption,td,th";
const SKIP = "script,style,noscript,nav,header>nav,footer,aside,svg,math,sup.footnote,a.noteref,[aria-hidden=true],[hidden]";

/** Extract readable paragraphs from an HTML document or fragment. */
export function htmlToParagraphs(html: string | Document): string[] {
  const doc = typeof html === "string" ? new DOMParser().parseFromString(html, "text/html") : html;
  const root = (doc.querySelector("article, main, [role=main]") as HTMLElement | null) ?? doc.body;
  if (!root) return [];

  root.querySelectorAll(SKIP).forEach((el) => el.remove());

  // Leaf-most blocks only, so <li><p>..</p></li> isn't read twice.
  const blocks = Array.from(root.querySelectorAll<HTMLElement>(BLOCKS)).filter(
    (el) => !el.querySelector(BLOCKS),
  );

  // Text sitting directly in <div>s with no block children (common in ebooks).
  const looseDivs = Array.from(root.querySelectorAll<HTMLElement>("div")).filter(
    (el) => !el.querySelector(BLOCKS + ",div") && tidy(el.textContent ?? "").length > 0,
  );

  const ordered = [...blocks, ...looseDivs].sort((a, b) =>
    a === b ? 0 : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );

  const paragraphs = ordered.map((el) => tidy((el.textContent ?? "").replace(/\s+/g, " "))).filter((t) => t.length > 0);

  if (paragraphs.length === 0) {
    const fallback = tidy((root.textContent ?? "").replace(/\s+/g, " "));
    return fallback ? [fallback] : [];
  }
  return paragraphs;
}

export function htmlTitle(html: string | Document): string | null {
  const doc = typeof html === "string" ? new DOMParser().parseFromString(html, "text/html") : html;
  const t = doc.querySelector("title")?.textContent?.trim() || doc.querySelector("h1")?.textContent?.trim();
  return t || null;
}
