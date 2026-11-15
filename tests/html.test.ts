import { describe, expect, it } from "vitest";
import { htmlTitle, htmlToParagraphs } from "../src/lib/html";

describe("htmlToParagraphs", () => {
  it("reads blocks in order without duplicates or chrome", () => {
    const html = `<html><head><title>T</title><style>p{}</style></head><body>
      <nav>Menu Home</nav>
      <h1>Heading</h1>
      <p>First <b>para</b>.</p>
      <ul><li><p>Item one</p></li><li>Item two</li></ul>
      <div>Loose div text</div>
      <script>alert(1)</script>
      <footer>Copyright</footer>
    </body></html>`;
    expect(htmlToParagraphs(html)).toEqual(["Heading", "First para.", "Item one", "Item two", "Loose div text"]);
  });

  it("prefers <article> when present", () => {
    expect(htmlToParagraphs("<body><p>Sidebar</p><article><p>Story.</p></article></body>")).toEqual(["Story."]);
  });

  it("falls back to body text", () => {
    expect(htmlToParagraphs("<body>Just some text</body>")).toEqual(["Just some text"]);
  });

  it("finds a title", () => {
    expect(htmlTitle("<title> My page </title>")).toBe("My page");
    expect(htmlTitle("<body><h1>H</h1></body>")).toBe("H");
  });
});
