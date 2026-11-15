import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { parseEpub } from "../src/lib/epub";

async function makeEpub(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
      <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  );
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test Book</dc:title></metadata>
      <manifest>
        <item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
        <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
        <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml"/>
        <item id="css" href="style.css" media-type="text/css"/>
      </manifest>
      <spine><itemref idref="nav" linear="no"/><itemref idref="c1"/><itemref idref="c2"/></spine>
    </package>`,
  );
  zip.file("OEBPS/nav.xhtml", "<html><body><p>Table of contents</p></body></html>");
  zip.file("OEBPS/text/ch1.xhtml", "<html><body><h1>Chapter One</h1><p>It begins.</p></body></html>");
  zip.file("OEBPS/text/ch2.xhtml", "<html><body><p>It ends.</p></body></html>");
  return zip.generateAsync({ type: "uint8array" });
}

describe("parseEpub", () => {
  it("reads title and spine order, skipping non-linear items", async () => {
    const doc = await parseEpub(await makeEpub());
    expect(doc.title).toBe("Test Book");
    expect(doc.paragraphs).toEqual(["Chapter One", "It begins.", "It ends."]);
  });

  it("explains broken files", async () => {
    const zip = new JSZip();
    zip.file("hello.txt", "hi");
    await expect(parseEpub(await zip.generateAsync({ type: "uint8array" }))).rejects.toThrow(/container\.xml/);
  });
});
