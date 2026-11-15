import "./styles.css";
import { stripMarkdown, textToParagraphs } from "./lib/clean";
import { docId, type LoadedDoc } from "./lib/doc";
import { htmlTitle, htmlToParagraphs } from "./lib/html";
import { buildSentences, type Sentence } from "./lib/segment";
import { estimateSeconds, formatDuration } from "./lib/timing";
import { encodeWav, silence } from "./lib/wav";
import { Player, type PlayState } from "./player";
import { SAMPLE } from "./sample";
import {
  clearLastDoc,
  loadLastDoc,
  loadPosition,
  loadSettings,
  saveLastDoc,
  savePosition,
  saveSettings,
} from "./storage";
import { KOKORO_VOICES, KokoroEngine, type KokoroStatus } from "./tts/kokoro";
import { listSystemVoices, SystemEngine, systemSupported } from "./tts/system";
import type { Engine, VoiceOption } from "./tts/types";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const ui = {
  empty: $("empty"),
  dropZone: $("drop-zone"),
  resume: $("resume"),
  reader: $("reader"),
  title: $("doc-title"),
  meta: $("doc-meta"),
  body: $("doc-body"),
  player: $("player"),
  progress: $<HTMLInputElement>("progress"),
  play: $("play-btn"),
  prev: $("prev-btn"),
  next: $("next-btn"),
  position: $("position"),
  status: $("status"),
  voice: $<HTMLSelectElement>("voice-select"),
  rate: $<HTMLSelectElement>("rate-select"),
  exportBtn: $("export-btn"),
  close: $("close-btn"),
  fileInput: $<HTMLInputElement>("file-input"),
  pasteDialog: $<HTMLDialogElement>("paste-dialog"),
  pasteTitle: $<HTMLInputElement>("paste-title"),
  pasteText: $<HTMLTextAreaElement>("paste-text"),
  exportDialog: $<HTMLDialogElement>("export-dialog"),
  exportText: $("export-text"),
  exportProgress: $<HTMLProgressElement>("export-progress"),
  exportCancel: $("export-cancel"),
  overlay: $("drop-overlay"),
  toast: $("toast"),
};

const settings = loadSettings();
const kokoro = new KokoroEngine();
const system = new SystemEngine();
const webgpu = "gpu" in navigator;

let doc: LoadedDoc | null = null;
let currentDocId = "";
let sentences: Sentence[] = [];
let sentenceEls: HTMLElement[] = [];
let activeIndex = -1;
let activeWord = -1;
let waitingForAudio = false;

// ---------- voices ----------

function parseVoice(value: string): { engine: Engine; voice: string } {
  const [kind, ...rest] = value.split(":");
  const voice = rest.join(":");
  return kind === "system" && systemSupported ? { engine: system, voice } : { engine: kokoro, voice: voice || "af_heart" };
}

async function fillVoices() {
  const groups: Array<[string, VoiceOption[]]> = [["Natural voices (downloaded once, then offline)", KOKORO_VOICES]];
  const sys = await listSystemVoices();
  if (sys.length) groups.push(["Built-in voices (instant)", sys]);

  ui.voice.innerHTML = "";
  for (const [label, voices] of groups) {
    const group = document.createElement("optgroup");
    group.label = label;
    for (const v of voices) {
      const opt = document.createElement("option");
      opt.value = `${v.engine}:${v.id}`;
      opt.textContent = v.note ? `${v.label} — ${v.note}` : v.label;
      group.append(opt);
    }
    ui.voice.append(group);
  }
  if (![...ui.voice.options].some((o) => o.value === settings.voice)) settings.voice = "kokoro:af_heart";
  ui.voice.value = settings.voice;
}

const initial = parseVoice(settings.voice);

const player = new Player(initial.engine, initial.voice, {
  onSentence(i) {
    setActive(i);
    updatePosition();
    if (currentDocId) savePosition(currentDocId, i);
  },
  onWord(i, w) {
    if (waitingForAudio) setWaiting(false);
    setWord(i, w);
  },
  onState(state) {
    renderState(state);
  },
  onError(err) {
    setWaiting(false);
    showToast(`Couldn't play that: ${err.message}`);
  },
});

function renderState(state: PlayState) {
  document.body.classList.toggle("playing", state === "playing");
  ui.play.setAttribute("aria-label", state === "playing" ? "Pause" : "Play");
  if (state !== "playing") setWaiting(false);
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = state === "playing" ? "playing" : "paused";
}

function setWaiting(on: boolean) {
  waitingForAudio = on;
  document.body.classList.toggle("waiting", on);
}

kokoro.onStatus = (s: KokoroStatus) => {
  if (s.state === "ready") {
    try {
      localStorage.setItem("hark:voiceCached", "1");
    } catch {
      // ignore
    }
  }
  renderKokoroStatus(s);
};

/** Start loading the natural voice early so it's ready by the time someone presses play. */
function warmUp() {
  if (parseVoice(settings.voice).engine === kokoro) kokoro.load();
}

function renderKokoroStatus(s: KokoroStatus) {
  if (parseVoice(settings.voice).engine !== kokoro) {
    ui.status.textContent = "";
    return;
  }
  switch (s.state) {
    case "loading": {
      const pct = s.total ? Math.round((s.loaded / s.total) * 100) : 0;
      ui.status.innerHTML = "";
      ui.status.append(
        `Preparing natural voice${s.total ? ` · ${pct}%` : "…"} (the first time takes a minute) `,
        systemSupported ? linkButton("Use a built-in voice instead", useSystemVoice) : "",
      );
      break;
    }
    case "ready":
      ui.status.textContent = s.device === "wasm" && !webgpu ? "Natural voice ready (no GPU found, may be slower)" : "";
      if (s.device === "webgpu" || webgpu) setTimeout(() => (ui.status.textContent = ""), 2500);
      break;
    case "error":
      ui.status.innerHTML = "";
      ui.status.append(
        "Natural voice failed to load. ",
        systemSupported ? linkButton("Use a built-in voice", useSystemVoice) : "Try reloading the page.",
      );
      break;
    default:
      ui.status.textContent = "";
  }
}

function linkButton(text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = text;
  b.onclick = onClick;
  return b;
}

function useSystemVoice() {
  const first = [...ui.voice.options].find((o) => o.value.startsWith("system:"));
  if (!first) return;
  ui.voice.value = first.value;
  ui.voice.dispatchEvent(new Event("change"));
}

ui.voice.addEventListener("change", () => {
  settings.voice = ui.voice.value;
  saveSettings(settings);
  const { engine, voice } = parseVoice(settings.voice);
  if (engine === kokoro) kokoro.load();
  renderKokoroStatus(kokoro.status);
  player.setVoice(engine, voice);
});

ui.rate.value = String(settings.rate);
ui.rate.addEventListener("change", () => {
  settings.rate = Number(ui.rate.value);
  saveSettings(settings);
  player.setRate(settings.rate);
  updatePosition();
});
player.setRate(settings.rate);

// ---------- document rendering ----------

function openDoc(next: LoadedDoc, persist = true) {
  player.stop();
  doc = next;
  currentDocId = docId(next);
  sentences = buildSentences(next.paragraphs);
  if (sentences.length === 0) {
    showToast("That file doesn't seem to contain any readable text.");
    return;
  }

  ui.title.textContent = next.title;
  document.title = `${next.title} · Hark`;
  const words = sentences.reduce((n, s) => n + s.words.length, 0);
  ui.meta.textContent = `${words.toLocaleString()} words · about ${formatDuration(estimateSeconds(words, 1))} at 1×`;

  // Render paragraphs with one span per sentence.
  const frag = document.createDocumentFragment();
  sentenceEls = [];
  let p: HTMLParagraphElement | null = null;
  let para = -1;
  for (const s of sentences) {
    if (s.paragraph !== para) {
      para = s.paragraph;
      p = document.createElement("p");
      frag.append(p);
    } else {
      p!.append(" ");
    }
    const span = document.createElement("span");
    span.className = "s";
    span.dataset.i = String(s.index);
    span.textContent = s.text;
    p!.append(span);
    sentenceEls.push(span);
  }
  ui.body.replaceChildren(frag);
  activeIndex = -1;
  activeWord = -1;

  ui.progress.max = String(Math.max(sentences.length - 1, 0));
  ui.empty.hidden = true;
  ui.reader.hidden = false;
  ui.player.hidden = false;

  const start = loadPosition(currentDocId);
  player.load(sentences, start < sentences.length ? start : 0);
  if (start > 0) sentenceEls[player.index]?.scrollIntoView({ block: "center" });
  else window.scrollTo({ top: 0 });

  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: next.title, artist: "Hark" });
  }
  if (persist) void saveLastDoc(next);
  warmUp();
}

function closeDoc() {
  player.stop();
  doc = null;
  currentDocId = "";
  sentences = [];
  sentenceEls = [];
  ui.body.replaceChildren();
  ui.reader.hidden = true;
  ui.player.hidden = true;
  ui.empty.hidden = false;
  ui.resume.hidden = true;
  document.title = "Hark — free, private read-aloud";
  void clearLastDoc();
}

function setActive(i: number) {
  if (i === activeIndex) return;
  clearWord();
  sentenceEls[activeIndex]?.classList.remove("active");
  activeIndex = i;
  const el = sentenceEls[i];
  if (!el) return;
  el.classList.add("active");
  if (settings.follow) {
    const r = el.getBoundingClientRect();
    const bottomLimit = window.innerHeight - ui.player.offsetHeight - 40;
    if (r.top < 70 || r.bottom > bottomLimit) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

/** Split the active sentence into word spans the first time a word lights up. */
function setWord(i: number, w: number) {
  const el = sentenceEls[i];
  const s = sentences[i];
  if (!el || !s || w < 0) return;
  if (!el.dataset.split) {
    el.dataset.split = "1";
    const frag = document.createDocumentFragment();
    let pos = 0;
    s.words.forEach((word, k) => {
      if (word.start > pos) frag.append(s.text.slice(pos, word.start));
      const ws = document.createElement("span");
      ws.className = "w";
      ws.dataset.w = String(k);
      ws.textContent = word.text;
      frag.append(ws);
      pos = word.end;
    });
    if (pos < s.text.length) frag.append(s.text.slice(pos));
    el.replaceChildren(frag);
  }
  if (w === activeWord) return;
  el.querySelector(".w.on")?.classList.remove("on");
  el.querySelector(`.w[data-w="${w}"]`)?.classList.add("on");
  activeWord = w;
}

function clearWord() {
  const el = sentenceEls[activeIndex];
  if (el?.dataset.split) {
    delete el.dataset.split;
    el.textContent = sentences[activeIndex].text;
  }
  activeWord = -1;
}

function updatePosition() {
  if (!sentences.length) return;
  const i = player.index;
  ui.progress.value = String(i);
  const remainingWords = sentences.slice(i).reduce((n, s) => n + s.words.length, 0);
  const pct = Math.round((i / Math.max(sentences.length - 1, 1)) * 100);
  ui.position.textContent = `${pct}% · ${formatDuration(estimateSeconds(remainingWords, settings.rate))} left`;
}

// ---------- playback controls ----------

function play() {
  const { engine } = parseVoice(settings.voice);
  if (engine === kokoro && kokoro.status.state !== "ready") kokoro.load();
  if (player.state === "stopped") setWaiting(true);
  player.play();
}

ui.play.addEventListener("click", () => (player.state === "playing" ? player.pause() : play()));
ui.prev.addEventListener("click", () => player.prev());
ui.next.addEventListener("click", () => player.next());
ui.close.addEventListener("click", closeDoc);
ui.progress.addEventListener("input", () => {
  const i = Number(ui.progress.value);
  player.seek(i);
  sentenceEls[i]?.scrollIntoView({ block: "center" });
});

ui.body.addEventListener("click", (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>(".s");
  if (!el || window.getSelection()?.toString()) return;
  const i = Number(el.dataset.i);
  player.seek(i);
  if (player.state === "stopped") play();
});

document.addEventListener("keydown", (e) => {
  if (!doc || e.metaKey || e.ctrlKey || e.altKey) return;
  const target = e.target as HTMLElement;
  if (target.closest("input, textarea, select, dialog, [contenteditable]")) return;
  if (e.key === " " || e.key === "k") {
    e.preventDefault();
    if (player.state === "playing") player.pause();
    else play();
  } else if (e.key === "ArrowRight" || e.key === "l") {
    e.preventDefault();
    player.next();
  } else if (e.key === "ArrowLeft" || e.key === "j") {
    e.preventDefault();
    player.prev();
  }
});

if ("mediaSession" in navigator) {
  navigator.mediaSession.setActionHandler("play", play);
  navigator.mediaSession.setActionHandler("pause", () => player.pause());
  navigator.mediaSession.setActionHandler("previoustrack", () => player.prev());
  navigator.mediaSession.setActionHandler("nexttrack", () => player.next());
}

// ---------- font size ----------

function applyFont() {
  document.documentElement.style.setProperty("--font-size", `${settings.fontSize}px`);
}
$("font-up").addEventListener("click", () => {
  settings.fontSize = Math.min(settings.fontSize + 2, 36);
  applyFont();
  saveSettings(settings);
});
$("font-down").addEventListener("click", () => {
  settings.fontSize = Math.max(settings.fontSize - 2, 14);
  applyFont();
  saveSettings(settings);
});
applyFont();

// ---------- opening files ----------

async function readFile(file: File) {
  const name = file.name.replace(/\.[^.]+$/, "") || "Untitled";
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  try {
    if (ext === "pdf" || file.type === "application/pdf") {
      showToast("Reading PDF…", 0);
      const { parsePdf } = await import("./lib/pdf");
      const loaded = await parsePdf(await file.arrayBuffer(), name, (n, total) => {
        if (total > 5) showToast(`Reading PDF… page ${n} of ${total}`, 0);
      });
      hideToast();
      openDoc(loaded);
    } else if (ext === "epub" || file.type === "application/epub+zip") {
      showToast("Reading ebook…", 0);
      const { parseEpub } = await import("./lib/epub");
      openDoc(await parseEpub(await file.arrayBuffer(), name));
      hideToast();
    } else if (ext === "html" || ext === "htm" || file.type === "text/html") {
      const html = await file.text();
      openDoc({ title: htmlTitle(html) ?? name, paragraphs: htmlToParagraphs(html) });
    } else if (ext === "md" || ext === "markdown") {
      openDoc({ title: name, paragraphs: textToParagraphs(stripMarkdown(await file.text())) });
    } else if (ext === "txt" || file.type.startsWith("text/")) {
      openDoc({ title: name, paragraphs: textToParagraphs(await file.text()) });
    } else {
      showToast("Hark can read PDF, EPUB, TXT, Markdown and HTML files.");
    }
  } catch (err) {
    console.error(err);
    showToast((err as Error).message || "Couldn't open that file.");
  }
}

$("open-btn").addEventListener("click", () => ui.fileInput.click());
ui.dropZone.addEventListener("click", () => ui.fileInput.click());
ui.dropZone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    ui.fileInput.click();
  }
});
ui.fileInput.addEventListener("change", () => {
  const file = ui.fileInput.files?.[0];
  if (file) void readFile(file);
  ui.fileInput.value = "";
});
$("sample-btn").addEventListener("click", () => {
  openDoc(SAMPLE);
  play();
});

let dragDepth = 0;
window.addEventListener("dragenter", (e) => {
  if (!e.dataTransfer?.types.includes("Files")) return;
  dragDepth++;
  ui.overlay.hidden = false;
});
window.addEventListener("dragleave", () => {
  dragDepth = Math.max(dragDepth - 1, 0);
  if (dragDepth === 0) ui.overlay.hidden = true;
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  ui.overlay.hidden = true;
  const file = e.dataTransfer?.files?.[0];
  if (file) void readFile(file);
});

// Paste anywhere (outside inputs) to read the clipboard text.
document.addEventListener("paste", (e) => {
  if ((e.target as HTMLElement).closest("input, textarea, [contenteditable]")) return;
  const file = e.clipboardData?.files?.[0];
  if (file) {
    e.preventDefault();
    void readFile(file);
    return;
  }
  const text = e.clipboardData?.getData("text/plain")?.trim();
  if (text && text.length > 20) {
    e.preventDefault();
    openDoc({ title: firstWords(text), paragraphs: textToParagraphs(text) });
  }
});

function openPaste() {
  ui.pasteTitle.value = "";
  ui.pasteText.value = "";
  ui.pasteDialog.showModal();
  ui.pasteText.focus();
}
$("paste-btn").addEventListener("click", openPaste);
$("paste-btn-2").addEventListener("click", openPaste);
ui.pasteDialog.addEventListener("close", () => {
  if (ui.pasteDialog.returnValue !== "read") return;
  const text = ui.pasteText.value.trim();
  if (!text) return;
  openDoc({ title: ui.pasteTitle.value.trim() || firstWords(text), paragraphs: textToParagraphs(text) });
  play();
});

function firstWords(text: string): string {
  const words = text.split(/\s+/).slice(0, 8).join(" ");
  return words.length < text.length ? `${words}…` : words;
}

// ---------- export ----------

let exportRun = 0;

ui.exportBtn.addEventListener("click", async () => {
  if (!doc || !sentences.length) return;
  const { engine, voice } = parseVoice(settings.voice);
  if (engine !== kokoro) {
    showToast("Saving audio works with the natural voices. Pick one from the voice menu first.");
    return;
  }
  const words = sentences.reduce((n, s) => n + s.words.length, 0);
  const minutes = estimateSeconds(words, settings.rate) / 60;
  if (minutes > 90 && !confirm(`This is about ${formatDuration(minutes * 60)} of audio and may take a long time to make. Continue?`)) {
    return;
  }

  player.pause();
  const run = ++exportRun;
  ui.exportProgress.value = 0;
  ui.exportText.textContent = "Preparing the voice…";
  ui.exportDialog.showModal();

  try {
    const chunks: Float32Array[] = [];
    let sampleRate = 24000;
    const started = performance.now();
    for (let i = 0; i < sentences.length; i++) {
      if (run !== exportRun) return;
      const clip = await kokoro.synth(sentences[i].text, voice, settings.rate);
      sampleRate = clip.sampleRate;
      chunks.push(clip.samples.slice());
      const nextPara = sentences[i + 1]?.paragraph !== sentences[i].paragraph;
      chunks.push(silence(nextPara ? 0.45 : 0.15, sampleRate));
      ui.exportProgress.value = (i + 1) / sentences.length;
      const elapsed = (performance.now() - started) / 1000;
      const eta = (elapsed / (i + 1)) * (sentences.length - i - 1);
      ui.exportText.textContent = `Sentence ${i + 1} of ${sentences.length} · about ${formatDuration(eta)} left`;
    }
    const blob = new Blob([encodeWav(chunks, sampleRate)], { type: "audio/wav" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${doc.title.replace(/[\\/:*?"<>|]+/g, "").slice(0, 80) || "hark"}.wav`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    ui.exportDialog.close();
  } catch (err) {
    ui.exportDialog.close();
    showToast(`Couldn't save audio: ${(err as Error).message}`);
  }
});

ui.exportCancel.addEventListener("click", () => {
  exportRun++;
  ui.exportDialog.close();
});

// ---------- toast ----------

let toastTimer = 0;
function showToast(text: string, ms = 5000) {
  ui.toast.textContent = text;
  ui.toast.hidden = false;
  clearTimeout(toastTimer);
  if (ms) toastTimer = window.setTimeout(hideToast, ms);
}
function hideToast() {
  ui.toast.hidden = true;
}

// ---------- start ----------

void fillVoices().then(() => {
  const { engine, voice } = parseVoice(settings.voice);
  player.setVoice(engine, voice);
});

// Returning visitors already have the voice cached: load it right away.
try {
  if (localStorage.getItem("hark:voiceCached")) warmUp();
} catch {
  // ignore
}

void loadLastDoc().then((last) => {
  if (!last || doc) return;
  ui.resume.hidden = false;
  ui.resume.replaceChildren("Pick up where you left off: ", linkButton(last.title, () => openDoc(last, false)));
});
