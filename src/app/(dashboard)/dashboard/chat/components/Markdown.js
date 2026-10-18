"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/shared/utils/cn";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

/**
 * Prose styling for model output. Expressed as Tailwind arbitrary variants so the
 * markdown body needs no global stylesheet entry (globals.css stays untouched).
 */
const MARKDOWN_CLASSES = [
  "chat-markdown text-[14px] leading-relaxed text-text-main break-words",
  "[&_p]:my-2",
  "[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold",
  "[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold",
  "[&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:font-semibold",
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
  "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_li]:my-0.5",
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
  "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-text-muted",
  "[&_hr]:my-4 [&_hr]:border-border-subtle",
  "[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse",
  "[&_th]:border [&_th]:border-border-subtle [&_th]:px-2 [&_th]:py-1 [&_th]:text-left",
  "[&_td]:border [&_td]:border-border-subtle [&_td]:px-2 [&_td]:py-1",
  "[&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]",
  "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border-subtle [&_pre]:bg-bg [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-[12.5px] [&_pre]:leading-relaxed",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[12.5px]",
].join(" ");

const COPY_BUTTON =
  '<button type="button" class="md-code-copy absolute right-2 top-2 rounded-md border border-border bg-surface/90 px-2 py-1 text-[11px] font-medium text-text-muted shadow-sm transition-opacity hover:text-text-main opacity-100 [@media(hover:hover)]:sm:opacity-0 sm:group-hover:opacity-100" aria-label="Copy code">Copy</button>';

let markedPromise = null;

/**
 * A module-local `Marked` instance so the shared `marked` singleton is left
 * untouched. Its `html` renderer emits any raw HTML token as inert text — a
 * second line of defense behind the source-level `<` escaping above, which in
 * practice means no HTML token is ever produced.
 */
function loadMarked() {
  if (!markedPromise) {
    markedPromise = import("marked").then((mod) => {
      const Marked = mod.Marked || mod.marked?.Marked || mod.default?.Marked;
      return new Marked({
        gfm: true,
        breaks: true,
        renderer: {
          html: (token) =>
            escapeMarkdownSource(
              typeof token === "string" ? token : token?.text ?? ""
            ),
        },
      });
    });
  }
  return markedPromise;
}

/**
 * Neutralize any raw HTML in the model's source text before it reaches marked.
 * `<` is the only character that can open a tag, so escaping it is enough to stop
 * injected markup while leaving valid markdown (including inline HTML on purpose)
 * as literal text.
 */
export function escapeMarkdownSource(source) {
  return String(source ?? "").replace(/</g, "&lt;");
}

/** Wrap each `<pre>` in a positioned container with a copy button. */
function wrapCodeBlocks(html) {
  return html.replace(
    /<pre(?:\s[^>]*)?>[\s\S]*?<\/pre>/g,
    (match) => `<div class="md-code-block group relative">${COPY_BUTTON}${match}</div>`
  );
}

/**
 * Decode HTML character references that a browser would decode inside an
 * attribute value. A single pass, matching browser behavior: a double-encoded
 * value stays inert because it is not decoded twice.
 */
const NAMED_ENTITIES = {
  colon: ":",
  tab: "\t",
  newline: "\n",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  sol: "/",
  period: ".",
  num: "#",
};

function decodeEntities(value) {
  return String(value).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      if (Number.isFinite(code)) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return match;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named === undefined ? match : named;
  });
}

/**
 * A href is safe when it is a relative / in-page target, or an explicit
 * http(s)/mailto link. Anything with another scheme (javascript:, data:,
 * vbscript:, file:, …) is rejected. Entities are decoded and the controls the
 * HTML URL parser ignores are stripped first, so `java&#115;cript:` and
 * `java\nscript:` are caught too.
 */
function isSafeHref(href) {
  const value = decodeEntities(href)
    .replace(/[\u0000-\u0020]/g, "")
    .trim();
  if (!value) return false;
  if (
    value[0] === "#" ||
    value[0] === "/" ||
    value[0] === "?" ||
    value.startsWith("./") ||
    value.startsWith("../")
  ) {
    return true;
  }
  const scheme = value.match(/^([a-z][a-z0-9+.-]*):/i);
  if (!scheme) return true; // no scheme → treated as relative
  const name = scheme[1].toLowerCase();
  return name === "http" || name === "https" || name === "mailto";
}

/**
 * Rewrite one URL attribute (`href`/`src`) on every `<tag>` whose value fails
 * `isSafeHref`, so links and images share a single scheme policy. A rejected
 * attribute is dropped and the tag itself is kept, leaving the surrounding
 * content intact; `onDrop` may add a fallback attribute for the tag.
 */
function sanitizeScheme(html, tagName, attrName, onDrop) {
  const tagPattern = new RegExp(`<${tagName}\\b((?:"[^"]*"|[^">])*)>`, "gi");
  const attrPattern = new RegExp(`\\s${attrName}="([^"]*)"`, "i");
  return html.replace(tagPattern, (tag, attrs) => {
    const match = attrs.match(attrPattern);
    if (!match || isSafeHref(match[1])) return tag;
    const rest = attrs.replace(attrPattern, "");
    return `<${tagName}${rest}${onDrop ? onDrop(attrs) : ""}>`;
  });
}

/** Drop an anchor href with an unsafe scheme, keeping the link text. */
function sanitizeLinks(html) {
  return sanitizeScheme(html, "a", "href");
}

/**
 * Apply the same scheme policy to image `src` (markdown images are
 * model-controlled, so an unsafe `src` must not trigger a request). A dropped
 * `src` gains an empty `alt`; the image is neither linked nor replaced.
 */
function sanitizeImages(html) {
  return sanitizeScheme(html, "img", "src", (attrs) =>
    /\salt="/i.test(attrs) ? "" : ' alt=""'
  );
}

export async function renderMarkdown(source) {
  const marked = await loadMarked();
  const html = marked.parse(escapeMarkdownSource(source));
  return wrapCodeBlocks(sanitizeImages(sanitizeLinks(html)));
}

export default function Markdown({ text, className }) {
  const [html, setHtml] = useState("");
  const { copy } = useCopyToClipboard(1500);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!text) return undefined;
    let cancelled = false;
    if (timerRef.current) clearTimeout(timerRef.current);
    // Coalesce rapid streaming updates into a single parse.
    timerRef.current = setTimeout(() => {
      renderMarkdown(text)
        .then((out) => {
          if (!cancelled) setHtml(out);
        })
        .catch(() => {
          if (!cancelled) setHtml("");
        });
    }, 20);
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [text]);

  const handleClick = useCallback(
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest(".md-code-copy");
      if (!button) return;
      const block = button.closest(".md-code-block");
      const code = block?.querySelector("pre")?.innerText || "";
      copy(code, "code");
      const original = button.textContent;
      button.textContent = "Copied!";
      setTimeout(() => {
        if (button.isConnected) button.textContent = original;
      }, 1500);
    },
    [copy]
  );

  if (!text || !html) return null;

  return (
    <div
      className={cn(MARKDOWN_CLASSES, className)}
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
