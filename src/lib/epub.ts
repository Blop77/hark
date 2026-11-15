import JSZip from "jszip";
import { htmlToParagraphs } from "./html";
import type { LoadedDoc } from "./doc";

function resolvePath(base: string, href: string): string {
  const parts = (base.includes("/") ? base.slice(0, base.lastIndexOf("/") + 1) : "").split("/").filter(Boolean);
  for (const seg of decodeURIComponent(href.split("#")[0]).split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

/** Read an EPUB's text in reading order (the OPF spine). */
export async function parseEpub(data: ArrayBuffer | Uint8Array, fallbackTitle = "Untitled book"): Promise<LoadedDoc> {
  const zip = await JSZip.loadAsync(data);
  const parser = new DOMParser();

  const container = await zip.file("META-INF/container.xml")?.async("string");
  if (!container) throw new Error("This EPUB is missing META-INF/container.xml.");
  const opfPath = parser.parseFromString(container, "application/xml").querySelector("rootfile")?.getAttribute("full-path");
  if (!opfPath) throw new Error("This EPUB doesn't say where its contents are.");

  const opfXml = await zip.file(opfPath)?.async("string");
  if (!opfXml) throw new Error(`This EPUB is missing ${opfPath}.`);
  const opf = parser.parseFromString(opfXml, "application/xml");

  const title =
    opf.getElementsByTagName("dc:title")[0]?.textContent?.trim() ||
    opf.querySelector("title")?.textContent?.trim() ||
    fallbackTitle;

  const manifest = new Map<string, { href: string; type: string }>();
  for (const item of Array.from(opf.getElementsByTagName("item"))) {
    manifest.set(item.getAttribute("id") ?? "", {
      href: item.getAttribute("href") ?? "",
      type: item.getAttribute("media-type") ?? "",
    });
  }

  const paragraphs: string[] = [];
  for (const ref of Array.from(opf.getElementsByTagName("itemref"))) {
    if (ref.getAttribute("linear") === "no") continue;
    const item = manifest.get(ref.getAttribute("idref") ?? "");
    if (!item || !/x?html/.test(item.type)) continue;
    const html = await zip.file(resolvePath(opfPath, item.href))?.async("string");
    if (!html) continue;
    paragraphs.push(...htmlToParagraphs(parser.parseFromString(html, "text/html")));
  }

  if (paragraphs.length === 0) throw new Error("Couldn't find any readable text in this EPUB.");
  return { title, paragraphs };
}
