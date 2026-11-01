// Linear scans of untrusted HTML (store pages, the public check). Regexes such as /<meta[^>]+a[^>]+b/ backtrack
// quadratically on a page of "<meta <meta <meta …" with no ">", which a hostile site can serve: 512 KB took 37 s.
// Here every opening tag is found with indexOf, so the work is proportional to the page, and attribute regexes only
// ever run on one tag (at most MAX_TAG characters).
const MAX_TAG = 4000;
const AFTER_NAME = new Set([9, 10, 12, 13, 32, 47, 62]); // whitespace, "/", ">"

// The opening tags <name …> in document order, each as its own string.
export function openTags(html: string, name: string, maxTag = MAX_TAG): string[] {
  const lower = html.toLowerCase();
  const needle = `<${name.toLowerCase()}`;
  const out: string[] = [];
  for (let i = lower.indexOf(needle); i !== -1; ) {
    if (!AFTER_NAME.has(lower.charCodeAt(i + needle.length))) {
      i = lower.indexOf(needle, i + needle.length);
      continue;
    }
    const end = html.indexOf(">", i);
    if (end === -1) break;
    if (end - i <= maxTag) out.push(html.slice(i, end + 1));
    i = lower.indexOf(needle, end + 1);
  }
  return out;
}

// <name …>text</name> elements: the opening tag and the text up to the matching closing tag (no nesting).
export function elements(html: string, name: string, maxTag = MAX_TAG): { tag: string; text: string }[] {
  const lower = html.toLowerCase();
  const open = `<${name.toLowerCase()}`;
  const close = `</${name.toLowerCase()}`;
  const out: { tag: string; text: string }[] = [];
  for (let i = lower.indexOf(open); i !== -1; ) {
    if (!AFTER_NAME.has(lower.charCodeAt(i + open.length))) {
      i = lower.indexOf(open, i + open.length);
      continue;
    }
    const end = html.indexOf(">", i);
    if (end === -1) break;
    const stop = lower.indexOf(close, end + 1);
    if (stop === -1) break;
    if (end - i <= maxTag) out.push({ tag: html.slice(i, end + 1), text: html.slice(end + 1, stop) });
    i = lower.indexOf(open, stop + close.length);
  }
  return out;
}

// The value of one attribute in a single tag string (quoted or not), or null.
export function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : null;
}

// <meta name|property="key" content="…">: the content of the first meta tag whose name or property matches.
export function metaContent(html: string, keys: RegExp): string | null {
  for (const tag of openTags(html, "meta")) {
    const key = attr(tag, "name") ?? attr(tag, "property");
    if (key !== null && keys.test(key)) {
      const content = attr(tag, "content");
      if (content !== null) return content;
    }
  }
  return null;
}
