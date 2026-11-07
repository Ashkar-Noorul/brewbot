export interface Chunk {
  title: string;
  section: string;
  content: string;
}

const MAX_CHARS = 1200;
const OVERLAP_CHARS = 200;

/**
 * Splits a markdown document on "## " headings so each chunk stays on one topic,
 * then splits long sections by paragraph with a little overlap.
 * The document title (first "# " heading) is prefixed to every chunk so the
 * embedding knows which document it came from.
 */
export function chunkMarkdown(markdown: string, fallbackTitle: string): Chunk[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const title = lines.find((l) => l.startsWith("# "))?.slice(2).trim() ?? fallbackTitle;

  const sections: { section: string; body: string[] }[] = [];
  let current = { section: "Overview", body: [] as string[] };
  for (const line of lines) {
    if (line.startsWith("# ")) continue;
    if (line.startsWith("## ")) {
      if (current.body.join("").trim()) sections.push(current);
      current = { section: line.slice(3).trim(), body: [] };
    } else {
      current.body.push(line);
    }
  }
  if (current.body.join("").trim()) sections.push(current);

  const chunks: Chunk[] = [];
  for (const { section, body } of sections) {
    for (const piece of splitLong(body.join("\n").trim())) {
      chunks.push({ title, section, content: `${title} > ${section}\n\n${piece}` });
    }
  }
  return chunks;
}

function splitLong(text: string): string[] {
  if (text.length <= MAX_CHARS) return [text];

  const paragraphs = text.split(/\n{2,}/);
  const pieces: string[] = [];
  let buffer = "";
  for (const paragraph of paragraphs) {
    if (buffer && buffer.length + paragraph.length > MAX_CHARS) {
      pieces.push(buffer.trim());
      buffer = buffer.slice(-OVERLAP_CHARS);
    }
    buffer += `\n\n${paragraph}`;
  }
  if (buffer.trim()) pieces.push(buffer.trim());
  return pieces;
}
