import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorView } from "@tiptap/pm/view";

/**
 * Line-level pagination for the docs editor — the real "text parts per page"
 * model.
 *
 * The editor is one flowing contenteditable rendered on top of a stack of
 * white "page sheets". Each page exposes a content band of height `H`; the
 * vertical jump from the bottom of one band to the top of the next (bottom
 * margin + page gap + top margin) is `B`.
 *
 * Instead of breaking whole blocks (which can't handle a paragraph or table
 * taller than a page — it bleeds across the gap), we measure the *actual
 * rendered line boxes* with `Range.getClientRects()` — the same geometry the
 * browser uses to lay out text. We then walk those line boxes top to bottom
 * and, the moment a line would cross the bottom of the current page band, we
 * insert a block-level spacer widget *at that line's position* (mid-paragraph,
 * between list items, or between table rows) that pushes the line — and
 * everything after it — to the top of the next page's content band.
 *
 * Why this is stable:
 *  - Line positions come straight from layout, so nothing accumulates rounding
 *    error: the page boundary always lines up with where the text actually is.
 *  - We read positions relative to the editor's content origin and divide out
 *    the zoom transform, so it's correct at any zoom.
 *  - Spacers we injected last pass are subtracted out before measuring, so the
 *    layout converges instead of feeding back on itself.
 *  - Breaks land on line boundaries, so a line is never cut in half.
 */

export interface PageGeometry {
  /** Usable content height per page = pageHeight - top - bottom margins. */
  contentHeight: number;
  /** Vertical jump from the end of one page's content band to the start of
   *  the next = bottomMargin + pageGap + topMargin. */
  breakHeight: number;
}

export interface PaginationOptions {
  getGeometry: () => PageGeometry;
  onPageCount?: (pages: number) => void;
}

/** Plugin state: the spacer decorations plus a version counter that is bumped
 *  only by real layout-affecting changes (content edits or an explicit
 *  `forcePaginate`). Scrolling and cursor moves leave the version untouched so
 *  pagination never re-runs — and never shakes — while you read or scroll. */
interface PagState {
  deco: DecorationSet;
  ver: number;
}

export const paginationKey = new PluginKey<PagState>("docsPagination");

/** A measured line/row box in document order, in layout px relative to the
 *  editor's content origin (zoom already divided out). */
interface LineBox {
  /** Natural top with any injected spacer above it removed. */
  top: number;
  /** Rendered box height. */
  height: number;
  /** Doc position to anchor a break spacer before this line. */
  pos: number;
  /**
   * What kind of break this line needs:
   *  - "text": a normal line of text → a block `<div>` spacer.
   *  - "atom": a whole non-splittable object (image, chart, rule) → push the
   *    entire object to the next page with a block `<div>` spacer.
   *  - "tableRow": a table row → a spacer `<tr>` *inside* the table so the
   *    rows below continue on the next page (a `<div>` can't sit between rows).
   */
  kind: "text" | "atom" | "tableRow";
  /** tableRow only: number of columns, for the spacer row's colspan. */
  cols?: number;
  /** tableRow only: true for a table's first row — breaking here pushes the
   *  whole table to the next page rather than splitting it. */
  firstRow?: boolean;
}

const EPS = 0.75;

export const Pagination = Extension.create<PaginationOptions>({
  name: "docsPagination",

  addOptions() {
    return {
      getGeometry: () => ({ contentHeight: 0, breakHeight: 0 }),
      onPageCount: undefined,
    };
  },

  addProseMirrorPlugins() {
    const getGeometry = this.options.getGeometry;
    const onPageCount = this.options.onPageCount;

    return [
      new Plugin<PagState>({
        key: paginationKey,
        state: {
          init: () => ({ deco: DecorationSet.empty, ver: 0 }),
          apply(tr, old) {
            // A freshly measured decoration set committed by the view below.
            const next = tr.getMeta(paginationKey) as DecorationSet | undefined;
            if (next) return { deco: next, ver: old.ver };
            // Explicit re-paginate request (page size / margins / font / spacing
            // changed without the document changing) bumps the version.
            const force = tr.getMeta("forcePaginate");
            const ver = force ? old.ver + 1 : old.ver;
            const deco = tr.docChanged ? old.deco.map(tr.mapping, tr.doc) : old.deco;
            return { deco, ver };
          },
        },
        props: {
          decorations(state) {
            return paginationKey.getState(state)?.deco ?? DecorationSet.empty;
          },
        },
        view(view) {
          let raf = 0;
          let signature = "";

          const measure = () => {
            const { contentHeight: H, breakHeight: B } = getGeometry();
            if (!H || H <= 0) return;

            // Zoom: rects come back scaled by the canvas transform, but H/B and
            // the spacer heights are unscaled layout px — divide it out.
            const scale =
              view.dom.offsetWidth > 0
                ? view.dom.getBoundingClientRect().width / view.dom.offsetWidth
                : 1;
            const s = scale > 0 ? scale : 1;

            // Content origin = top of the editor's content box (inside padding).
            const domRect = view.dom.getBoundingClientRect();
            const padTop =
              parseFloat(window.getComputedStyle(view.dom).paddingTop) || 0;
            const originY = domRect.top + padTop * scale;

            // The spacers currently rendered, read from plugin state (which
            // ProseMirror keeps mapped through every edit) so their positions
            // are never stale. Subtracting them recovers each line's natural,
            // un-paginated top — making one measuring pass exact and stable.
            const currentDeco = paginationKey.getState(view.state)?.deco;
            const injected = (currentDeco?.find() ?? []).map((d) => ({
              pos: d.from,
              height: (d.spec?.height as number) || 0,
            }));

            const lines = collectLineBoxes(view, s, originY, injected);
            if (lines.length === 0) {
              if (signature !== "empty") commit(DecorationSet.empty, 1, "empty");
              return;
            }

            // Greedy line packing. `shift` is the total spacer height inserted
            // above the current line; each line's natural top + shift is its
            // final laid position.
            const decorations: Decoration[] = [];
            const sigParts: string[] = [];

            let page = 0;
            // Band 0's top is the content origin (natural y = 0), regardless of
            // any top margin on the first block.
            let firstTopOnPage = 0;
            let shift = 0;
            let pages = 1;

            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              const inBand = line.top - firstTopOnPage; // dist from page's 1st line
              const isFirstOnPage = i === 0 || inBand <= EPS;

              if (!isFirstOnPage && inBand + line.height > H + EPS) {
                // This line crosses the page bottom — push it to the next band.
                page += 1;
                const targetTop = page * (H + B);
                const fill = targetTop - (line.top + shift);
                if (fill > 0) {
                  // A mid-table row needs a spacer *row* inside the table; a
                  // table's first row (or any other block/object) is pushed
                  // whole with a block-level spacer.
                  const spacer =
                    line.kind === "tableRow" && !line.firstRow
                      ? makeRowSpacer(line.pos, fill, line.cols ?? 1)
                      : makeSpacer(line.pos, fill);
                  decorations.push(spacer);
                  sigParts.push(`${line.pos}:${Math.round(fill)}`);
                  shift += fill;
                }
                firstTopOnPage = line.top;
                pages += 1;
              }

              // A single atom taller than a page (big image) spans extra sheets.
              if (line.kind === "atom" && line.height > H) {
                const extra = Math.floor((line.height - EPS) / H);
                pages += extra;
                page += extra;
                firstTopOnPage = line.top - H * extra;
              }
            }

            const nextSig = `${sigParts.join("|")}#${pages}`;
            if (nextSig === signature) return;
            commit(DecorationSet.create(view.state.doc, decorations), pages, nextSig);
          };

          const commit = (set: DecorationSet, pages: number, sig: string) => {
            signature = sig;
            view.dispatch(view.state.tr.setMeta(paginationKey, set));
            onPageCount?.(pages);
          };

          const schedule = () => {
            if (raf) cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => {
              raf = 0;
              measure();
            });
          };

          schedule();

          return {
            update(v, prevState) {
              // Only re-paginate when something that affects layout changed:
              // a content edit, or an explicit forcePaginate (version bump).
              // Selection changes, scrolling and our own decoration commits
              // leave both untouched, so the page stays rock-steady.
              const prev = paginationKey.getState(prevState);
              const cur = paginationKey.getState(v.state);
              const docChanged = !v.state.doc.eq(prevState.doc);
              const verChanged = (cur?.ver ?? 0) !== (prev?.ver ?? 0);
              if (docChanged || verChanged) schedule();
            },
            destroy() {
              if (raf) cancelAnimationFrame(raf);
            },
          };
        },
      }),
    ];
  },
});

/** Build a non-editable, block-level spacer decoration that breaks the line
 *  it's anchored before and pushes it to the next page band. */
function makeSpacer(pos: number, height: number): Decoration {
  return Decoration.widget(
    pos,
    () => {
      const el = document.createElement("div");
      el.className = "docs-page-spacer";
      el.style.cssText = `display:block;width:100%;height:${height}px;flex-basis:100%;pointer-events:none;user-select:none;`;
      el.setAttribute("contenteditable", "false");
      el.setAttribute("aria-hidden", "true");
      return el;
    },
    {
      side: -1,
      key: `pb-${pos}-${Math.round(height)}`,
      ignoreSelection: true,
      // Read back during the next measure to recover natural line positions.
      height,
    },
  );
}

/**
 * Build a spacer that pushes a *table row* (and everything below it) to the
 * next page. A `<div>` can't sit between table rows — the browser hoists it
 * out — so the spacer is itself a borderless `<tr>` spanning every column. The
 * page CSS uses `border-collapse`, so this empty row draws no border and the
 * page gap stays clean.
 */
function makeRowSpacer(pos: number, height: number, cols: number): Decoration {
  return Decoration.widget(
    pos,
    () => {
      const tr = document.createElement("tr");
      tr.className = "docs-page-spacer-row";
      tr.setAttribute("contenteditable", "false");
      tr.setAttribute("aria-hidden", "true");
      const td = document.createElement("td");
      td.colSpan = Math.max(1, cols);
      td.style.cssText = `height:${height}px;padding:0;border:0;background:transparent;`;
      tr.appendChild(td);
      return tr;
    },
    {
      side: -1,
      key: `pbr-${pos}-${Math.round(height)}`,
      ignoreSelection: true,
      height,
    },
  );
}

/**
 * Collect every rendered line/row box across the document in order, in layout
 * px relative to `originY`, with any spacer we injected above each line removed
 * so positions are "natural" (drift- and feedback-free).
 */
function collectLineBoxes(
  view: EditorView,
  s: number,
  originY: number,
  injected: { pos: number; height: number }[],
): LineBox[] {
  const out: LineBox[] = [];
  // Cumulative injected height above a given doc position.
  const injectedAbove = (pos: number) =>
    injected.reduce((a, b) => (b.pos <= pos ? a + b.height : a), 0);

  const pushBox = (
    top: number,
    height: number,
    pos: number,
    kind: LineBox["kind"],
    extra?: Pick<LineBox, "cols" | "firstRow">,
  ) => {
    if (!(height > 0)) return;
    out.push({
      top: (top - originY) / s - injectedAbove(pos),
      height: height / s,
      pos,
      kind,
      ...extra,
    });
  };

  view.state.doc.forEach((node, pos) => {
    const dom = view.nodeDOM(pos) as HTMLElement | null;
    if (!dom || dom.nodeType !== 1) return;
    const name = node.type.name;

    // Tables: walk the document's rows (not the DOM) so each break anchors at
    // the position *before* a row — the only place a spacer `<tr>` is valid.
    if (name === "table") {
      // Column count from the first row, honouring colspans, for the spacer.
      let cols = 0;
      node.firstChild?.forEach((cell) => {
        cols += (cell.attrs?.colspan as number) || 1;
      });
      cols = Math.max(1, cols);

      let index = 0;
      node.forEach((_row, rowOffset) => {
        const rowPos = pos + 1 + rowOffset; // position before this row
        const rowDom = view.nodeDOM(rowPos) as HTMLElement | null;
        if (rowDom && typeof rowDom.getBoundingClientRect === "function") {
          const r = rowDom.getBoundingClientRect();
          // First row breaks at the table itself (push the whole table); later
          // rows break at the row (split the table). `cols` rides along for the
          // spacer-row colspan.
          pushBox(r.top, r.height, index === 0 ? pos : rowPos, "tableRow", {
            cols,
            firstRow: index === 0,
          });
        }
        index += 1;
      });
      return;
    }

    // Non-splittable objects (images, charts, rules, any leaf/atom): measure
    // the whole element and push it as a unit.
    if (node.isAtom || name === "image" || name === "horizontalRule") {
      const r = dom.getBoundingClientRect();
      pushBox(r.top, r.height, pos, "atom");
      return;
    }

    // Text blocks (paragraphs, headings, quotes, lists): measure each visual
    // line via the browser's own line-box geometry.
    const rects = lineRectsOf(dom);
    if (rects.length === 0) {
      const r = dom.getBoundingClientRect();
      pushBox(r.top, r.height, pos, "text");
      return;
    }
    for (const r of rects) {
      const at = view.posAtCoords({ left: r.left + 2, top: r.top + r.height / 2 });
      pushBox(r.top, r.height, at ? at.pos : pos, "text");
    }
  });

  // Keep document order even if posAtCoords nudged a position.
  out.sort((a, b) => a.top - b.top);
  return out;
}

/** Per-line client rects for a block element, de-duplicated to one box per
 *  visual line (getClientRects can emit several fragments per line). */
function lineRectsOf(dom: HTMLElement): DOMRect[] {
  let rects: DOMRectList;
  try {
    const range = document.createRange();
    range.selectNodeContents(dom);
    rects = range.getClientRects();
  } catch {
    return [];
  }
  const lines: DOMRect[] = [];
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (!(r.width > 0) || !(r.height > 0)) continue;
    const last = lines[lines.length - 1];
    // Merge fragments that sit on the same visual line.
    if (last && Math.abs(r.top - last.top) < 2 && Math.abs(r.height - last.height) < 2) {
      const left = Math.min(last.left, r.left);
      const right = Math.max(last.right, r.right);
      const top = Math.min(last.top, r.top);
      const bottom = Math.max(last.bottom, r.bottom);
      lines[lines.length - 1] = new DOMRect(left, top, right - left, bottom - top);
    } else {
      lines.push(new DOMRect(r.left, r.top, r.width, r.height));
    }
  }
  return lines;
}

/** Force a re-paginate from outside (page size / margins / spacing / zoom
 *  changed without the document itself changing). */
export function repaginate(view: EditorView) {
  view.dispatch(view.state.tr.setMeta("forcePaginate", Date.now()));
}
