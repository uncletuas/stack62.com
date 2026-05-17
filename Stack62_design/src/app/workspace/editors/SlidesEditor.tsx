import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  Bold,
  Copy,
  GalleryHorizontal,
  Image as ImageIcon,
  Italic,
  LayoutTemplate,
  Maximize2,
  MoveDown,
  MoveUp,
  Palette,
  Plus,
  Presentation,
  Square,
  Trash2,
  Type,
  Underline,
} from "lucide-react";
import { appDialog } from "../../components/app-dialog";

/**
 * PowerPoint/Google-Slides-style presentation editor.
 *
 * Key shape:
 *   { version: 2, slides: [{ id, background, elements: [...] }] }
 *
 * Each slide is a fixed-aspect 1600×900 canvas. Elements are absolutely
 * positioned and can be a text box, image, or shape (rectangle/ellipse).
 * Click to select, drag to move, grab a handle to resize. The
 * inspector panel reveals contextual properties for the active element.
 *
 * Present mode (full-screen) flips through slides with arrow keys.
 *
 * Storage: JSON envelope. Legacy text imports (one slide per line, or
 * `# Title` Markdown) parse into slides automatically.
 */

const CANVAS_W = 1600;
const CANVAS_H = 900;

type ElementBase = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
};
type TextElement = ElementBase & {
  type: "text";
  text: string;
  fontSize: number;
  fontFamily: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  align?: "left" | "center" | "right";
  bg?: string;
};
type ImageElement = ElementBase & {
  type: "image";
  src: string;
  alt?: string;
};
type ShapeElement = ElementBase & {
  type: "shape";
  shape: "rect" | "ellipse";
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
};
type SlideElement = TextElement | ImageElement | ShapeElement;

type Slide = {
  id: string;
  background: string;
  elements: SlideElement[];
};

export type Deck = {
  version: 2;
  slides: Slide[];
  theme?: { font: string; accent: string };
};

const FONTS = [
  "'Inter', 'Arial', sans-serif",
  "Arial, Helvetica, sans-serif",
  "Georgia, 'Times New Roman', serif",
  "'Roboto', 'Arial', sans-serif",
  "ui-monospace, SFMono-Regular, Menlo, monospace",
];

export function SlidesEditor({
  text,
  onChange,
  title,
}: {
  text: string;
  onChange: (next: string) => void;
  title?: string;
}) {
  const [deck, setDeck] = useState<Deck>(() => parseDeck(text));
  const [activeIdx, setActiveIdx] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [presenting, setPresenting] = useState(false);
  const lastEmittedRef = useRef<string>("");
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stageScale, setStageScale] = useState(1);

  // Hydrate when text changes externally.
  useEffect(() => {
    if (text === lastEmittedRef.current) return;
    setDeck(parseDeck(text));
  }, [text]);

  const emit = useCallback(
    (next: Deck) => {
      const json = JSON.stringify(next);
      lastEmittedRef.current = json;
      onChange(json);
    },
    [onChange],
  );

  const slide = deck.slides[activeIdx] ?? deck.slides[0];
  const selectedEl = useMemo(
    () => slide?.elements.find((el) => el.id === selectedId) ?? null,
    [slide, selectedId],
  );

  /** Fit the 1600×900 canvas inside the stage area. Recomputes on
   *  window resize. */
  useEffect(() => {
    const compute = () => {
      const el = stageRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const sx = (rect.width - 32) / CANVAS_W;
      const sy = (rect.height - 32) / CANVAS_H;
      setStageScale(Math.max(0.05, Math.min(sx, sy, 1.5)));
    };
    compute();
    const obs = new ResizeObserver(compute);
    if (stageRef.current) obs.observe(stageRef.current);
    return () => obs.disconnect();
  }, []);

  const updateSlide = useCallback(
    (updater: (s: Slide) => Slide) => {
      setDeck((prev) => {
        const next: Deck = {
          ...prev,
          slides: prev.slides.map((s, i) => (i === activeIdx ? updater(s) : s)),
        };
        emit(next);
        return next;
      });
    },
    [activeIdx, emit],
  );

  const updateElement = useCallback(
    (id: string, patch: Partial<SlideElement>) => {
      updateSlide((s) => ({
        ...s,
        elements: s.elements.map((el) =>
          el.id === id ? ({ ...el, ...patch } as SlideElement) : el,
        ),
      }));
    },
    [updateSlide],
  );

  const addElement = useCallback(
    (el: SlideElement) => {
      updateSlide((s) => ({ ...s, elements: [...s.elements, el] }));
      setSelectedId(el.id);
    },
    [updateSlide],
  );

  const deleteElement = useCallback(
    (id: string) => {
      updateSlide((s) => ({ ...s, elements: s.elements.filter((el) => el.id !== id) }));
      setSelectedId((cur) => (cur === id ? null : cur));
    },
    [updateSlide],
  );

  /* ── Slide operations ─────────────────────────────────────────── */
  const addSlide = (layout: "blank" | "title" | "title-content" | "two-column" = "blank") => {
    const fresh = freshSlide(layout, deck.slides.length + 1);
    setDeck((prev) => {
      const next: Deck = { ...prev, slides: [...prev.slides, fresh] };
      emit(next);
      return next;
    });
    setActiveIdx(deck.slides.length);
    setSelectedId(null);
  };
  const duplicateSlide = () => {
    setDeck((prev) => {
      const cur = prev.slides[activeIdx];
      if (!cur) return prev;
      const copy: Slide = {
        ...cur,
        id: uid(),
        elements: cur.elements.map((el) => ({ ...el, id: uid() })),
      };
      const slides = [...prev.slides];
      slides.splice(activeIdx + 1, 0, copy);
      const next: Deck = { ...prev, slides };
      emit(next);
      return next;
    });
    setActiveIdx((cur) => cur + 1);
  };
  const removeSlide = (idx: number) => {
    if (deck.slides.length <= 1) return;
    setDeck((prev) => {
      const slides = prev.slides.filter((_, i) => i !== idx);
      const next: Deck = { ...prev, slides };
      emit(next);
      return next;
    });
    setActiveIdx((cur) => Math.max(0, Math.min(cur, deck.slides.length - 2)));
  };
  const moveSlide = (idx: number, delta: number) => {
    setDeck((prev) => {
      const slides = [...prev.slides];
      const target = idx + delta;
      if (target < 0 || target >= slides.length) return prev;
      [slides[idx], slides[target]] = [slides[target], slides[idx]];
      const next: Deck = { ...prev, slides };
      emit(next);
      return next;
    });
    setActiveIdx((cur) => cur + delta);
  };

  /* ── Insert helpers ───────────────────────────────────────────── */
  const insertText = () => {
    addElement({
      id: uid(),
      type: "text",
      x: 200,
      y: 350,
      w: 1200,
      h: 200,
      text: "Click to edit",
      fontSize: 48,
      fontFamily: FONTS[0],
    });
  };

  const insertImage = async () => {
    const url = await appDialog.prompt({
      title: "Insert image",
      placeholder: "https://example.com/image.png",
      inputType: "url",
      confirmLabel: "Insert",
    });
    if (!url) return;
    addElement({
      id: uid(),
      type: "image",
      x: 400, y: 200, w: 800, h: 500,
      src: url,
    });
  };

  const insertShape = (shape: "rect" | "ellipse") => {
    addElement({
      id: uid(),
      type: "shape",
      shape,
      x: 500, y: 300, w: 600, h: 300,
      fill: "#60a5fa",
      stroke: "#1d4ed8",
      strokeWidth: 2,
    });
  };

  /* ── Present mode ─────────────────────────────────────────────── */
  useEffect(() => {
    if (!presenting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPresenting(false);
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        setActiveIdx((cur) => Math.min(deck.slides.length - 1, cur + 1));
      }
      if (e.key === "ArrowLeft") {
        setActiveIdx((cur) => Math.max(0, cur - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [presenting, deck.slides.length]);

  /* ── Render ───────────────────────────────────────────────────── */
  if (presenting) {
    return <PresentMode deck={deck} activeIdx={activeIdx} onClose={() => setPresenting(false)} onNext={() => setActiveIdx((i) => Math.min(deck.slides.length - 1, i + 1))} onPrev={() => setActiveIdx((i) => Math.max(0, i - 1))} />;
  }

  return (
    <div className="flex h-full flex-col bg-app">
      {/* Toolbar */}
      <div
        className="sticky top-0 z-20 flex shrink-0 flex-wrap items-center gap-1 border-b border-app bg-app-elevated px-3 py-1.5"
        onMouseDown={(e) => e.preventDefault()}
      >
        <button
          onClick={() => addSlide("blank")}
          className="flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-accent-fg hover:opacity-90"
        >
          <Plus className="h-3.5 w-3.5" /> New slide
        </button>
        <select
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            addSlide(e.target.value as "blank" | "title" | "title-content" | "two-column");
            e.currentTarget.value = "";
          }}
          className="h-7 rounded border border-app bg-app-elevated px-2 text-[11px] text-app-muted"
          defaultValue=""
        >
          <option value="" disabled>Layout…</option>
          <option value="blank">Blank</option>
          <option value="title">Title</option>
          <option value="title-content">Title + body</option>
          <option value="two-column">Two-column</option>
        </select>
        <Sep />
        <ToolBtn title="Insert text" onPress={insertText}><Type className="h-4 w-4" /></ToolBtn>
        <ToolBtn title="Insert image" onPress={insertImage}><ImageIcon className="h-4 w-4" /></ToolBtn>
        <ToolBtn title="Insert rectangle" onPress={() => insertShape("rect")}><Square className="h-4 w-4" /></ToolBtn>
        <ToolBtn title="Insert ellipse" onPress={() => insertShape("ellipse")}><span className="block h-3 w-3 rounded-full border-2 border-current" /></ToolBtn>
        <Sep />
        <ToolBtn title="Duplicate slide" onPress={duplicateSlide}><Copy className="h-4 w-4" /></ToolBtn>
        <ToolBtn title="Delete slide" onPress={() => removeSlide(activeIdx)}><Trash2 className="h-4 w-4" /></ToolBtn>
        <ToolBtn title="Move up" onPress={() => moveSlide(activeIdx, -1)}><MoveUp className="h-4 w-4" /></ToolBtn>
        <ToolBtn title="Move down" onPress={() => moveSlide(activeIdx, 1)}><MoveDown className="h-4 w-4" /></ToolBtn>
        <Sep />
        <button
          onClick={() => setPresenting(true)}
          className="flex items-center gap-1.5 rounded-md border border-app px-2.5 py-1 text-xs font-medium text-app-muted hover:bg-app-hover"
        >
          <Presentation className="h-3.5 w-3.5" />
          Present
        </button>
        <span className="ml-auto truncate text-[10px] text-app-faint">{title}</span>
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Thumbnails */}
        <aside className="w-44 shrink-0 overflow-y-auto border-r border-app bg-app-elevated p-2">
          {deck.slides.map((s, i) => (
            <div
              key={s.id}
              className={`relative mb-2 cursor-pointer overflow-hidden rounded border ${
                i === activeIdx ? "border-accent ring-2 ring-accent/30" : "border-app"
              }`}
              onClick={() => { setActiveIdx(i); setSelectedId(null); }}
            >
              <div className="flex items-center justify-between gap-1 bg-app-elevated px-1.5 py-0.5 text-[10px] text-app-faint">
                <span>{i + 1}</span>
                {deck.slides.length > 1 && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeSlide(i); }}
                    className="rounded p-0.5 text-app-faint hover:bg-rose-500/15 hover:text-rose-400"
                    title="Delete slide"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </button>
                )}
              </div>
              <ThumbCanvas slide={s} />
            </div>
          ))}
          <button
            onClick={() => addSlide("blank")}
            className="flex w-full items-center justify-center gap-1 rounded border border-dashed border-app py-2 text-[11px] text-app-muted hover:bg-app-hover hover:text-app"
          >
            <Plus className="h-3 w-3" /> Add slide
          </button>
        </aside>

        {/* Stage */}
        <div
          ref={stageRef}
          className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-doc-canvas p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedId(null);
          }}
        >
          <div
            className="relative shadow-2xl"
            style={{
              width: CANVAS_W * stageScale,
              height: CANVAS_H * stageScale,
            }}
          >
            <div
              className="absolute left-0 top-0 origin-top-left"
              style={{
                width: CANVAS_W,
                height: CANVAS_H,
                transform: `scale(${stageScale})`,
                background: slide?.background ?? "#ffffff",
              }}
            >
              {slide?.elements.map((el) => (
                <ElementView
                  key={el.id}
                  element={el}
                  selected={el.id === selectedId}
                  onSelect={() => setSelectedId(el.id)}
                  onChange={(patch) => updateElement(el.id, patch)}
                  onDelete={() => deleteElement(el.id)}
                  stageScale={stageScale}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Inspector */}
        <aside className="w-64 shrink-0 overflow-y-auto border-l border-app bg-app-elevated p-3 text-sm">
          {selectedEl ? (
            <Inspector
              element={selectedEl}
              onChange={(patch) => updateElement(selectedEl.id, patch)}
              onDelete={() => deleteElement(selectedEl.id)}
            />
          ) : (
            <SlideInspector
              slide={slide}
              onChange={(patch) => updateSlide((s) => ({ ...s, ...patch }))}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

/* ── Element view ────────────────────────────────────────────────── */

function ElementView({
  element,
  selected,
  onSelect,
  onChange,
  onDelete,
  stageScale,
}: {
  element: SlideElement;
  selected: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<SlideElement>) => void;
  onDelete: () => void;
  stageScale: number;
}) {
  const [editing, setEditing] = useState(false);

  const onMouseDownDrag = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (editing) return;
    e.stopPropagation();
    onSelect();
    const startX = e.clientX;
    const startY = e.clientY;
    const startEx = element.x;
    const startEy = element.y;
    const move = (ev: MouseEvent) => {
      const dx = (ev.clientX - startX) / stageScale;
      const dy = (ev.clientY - startY) / stageScale;
      onChange({ x: Math.round(startEx + dx), y: Math.round(startEy + dy) });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const startResize = (corner: "nw" | "ne" | "sw" | "se") => (e: ReactMouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    onSelect();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = element.w;
    const startH = element.h;
    const startEx = element.x;
    const startEy = element.y;
    const move = (ev: MouseEvent) => {
      const dx = (ev.clientX - startX) / stageScale;
      const dy = (ev.clientY - startY) / stageScale;
      const next: Partial<SlideElement> = {};
      if (corner === "se") { next.w = Math.max(40, startW + dx); next.h = Math.max(40, startH + dy); }
      if (corner === "sw") { next.x = startEx + dx; next.w = Math.max(40, startW - dx); next.h = Math.max(40, startH + dy); }
      if (corner === "ne") { next.y = startEy + dy; next.w = Math.max(40, startW + dx); next.h = Math.max(40, startH - dy); }
      if (corner === "nw") { next.x = startEx + dx; next.y = startEy + dy; next.w = Math.max(40, startW - dx); next.h = Math.max(40, startH - dy); }
      onChange(next);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const baseStyle: React.CSSProperties = {
    position: "absolute",
    left: element.x,
    top: element.y,
    width: element.w,
    height: element.h,
    transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
    cursor: editing ? "text" : selected ? "move" : "pointer",
  };

  const handle = (corner: "nw" | "ne" | "sw" | "se") => (
    <div
      onMouseDown={startResize(corner)}
      className="absolute h-3 w-3 border-2 border-white bg-blue-500"
      style={{
        ...(corner.includes("n") ? { top: -6 } : { bottom: -6 }),
        ...(corner.includes("w") ? { left: -6 } : { right: -6 }),
        cursor: `${corner}-resize`,
        zIndex: 30,
      }}
    />
  );

  return (
    <div
      onMouseDown={onMouseDownDrag}
      onDoubleClick={() => element.type === "text" && setEditing(true)}
      style={baseStyle}
    >
      {element.type === "text" && (
        editing ? (
          <textarea
            autoFocus
            defaultValue={element.text}
            onBlur={(e) => { onChange({ text: e.target.value } as Partial<TextElement>); setEditing(false); }}
            onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }}
            className="h-full w-full resize-none border-0 bg-transparent p-2 outline-none"
            style={{
              fontSize: element.fontSize,
              fontFamily: element.fontFamily,
              fontWeight: element.bold ? 700 : 400,
              fontStyle: element.italic ? "italic" : "normal",
              textDecoration: element.underline ? "underline" : "none",
              color: element.color ?? "#111827",
              textAlign: element.align ?? "left",
              background: element.bg ?? "transparent",
            }}
          />
        ) : (
          <div
            className="h-full w-full whitespace-pre-wrap break-words p-2"
            style={{
              fontSize: element.fontSize,
              fontFamily: element.fontFamily,
              fontWeight: element.bold ? 700 : 400,
              fontStyle: element.italic ? "italic" : "normal",
              textDecoration: element.underline ? "underline" : "none",
              color: element.color ?? "#111827",
              textAlign: element.align ?? "left",
              background: element.bg ?? "transparent",
            }}
          >
            {element.text || <span style={{ color: "#9ca3af" }}>Click to edit</span>}
          </div>
        )
      )}

      {element.type === "image" && (
        <img
          src={element.src}
          alt={element.alt ?? ""}
          draggable={false}
          className="pointer-events-none h-full w-full object-cover"
        />
      )}

      {element.type === "shape" && (
        <div
          className="h-full w-full"
          style={{
            background: element.fill ?? "#60a5fa",
            border: element.strokeWidth ? `${element.strokeWidth}px solid ${element.stroke ?? "#1d4ed8"}` : undefined,
            borderRadius: element.shape === "ellipse" ? "50%" : "4px",
          }}
        />
      )}

      {selected && !editing && (
        <>
          <div
            className="pointer-events-none absolute inset-0 border-2 border-blue-500"
            style={{ outlineOffset: 2 }}
          />
          {handle("nw")}
          {handle("ne")}
          {handle("sw")}
          {handle("se")}
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="absolute -top-8 right-0 grid h-6 w-6 place-items-center rounded bg-rose-500 text-white shadow"
            title="Delete element"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </div>
  );
}

/* ── Inspector ───────────────────────────────────────────────────── */

function Inspector({
  element,
  onChange,
  onDelete,
}: {
  element: SlideElement;
  onChange: (patch: Partial<SlideElement>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-app-faint">
          {element.type === "text" ? "Text" : element.type === "image" ? "Image" : "Shape"}
        </h3>
        <button
          onClick={onDelete}
          className="text-xs text-rose-400 hover:underline"
          title="Delete"
        >
          Delete
        </button>
      </div>

      {/* Position */}
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="X" value={element.x} onChange={(v) => onChange({ x: v })} />
        <NumberField label="Y" value={element.y} onChange={(v) => onChange({ y: v })} />
        <NumberField label="W" value={element.w} onChange={(v) => onChange({ w: v })} />
        <NumberField label="H" value={element.h} onChange={(v) => onChange({ h: v })} />
      </div>

      {element.type === "text" && (
        <>
          <div className="space-y-1">
            <Label>Font</Label>
            <select
              value={element.fontFamily}
              onChange={(e) => onChange({ fontFamily: e.target.value } as Partial<TextElement>)}
              className="w-full rounded border border-app bg-app px-2 py-1 text-xs"
            >
              {FONTS.map((f) => <option key={f} value={f}>{f.replace(/['"]/g, "").split(",")[0]}</option>)}
            </select>
          </div>
          <NumberField
            label="Size (px)"
            value={element.fontSize}
            onChange={(v) => onChange({ fontSize: v } as Partial<TextElement>)}
          />
          <div className="flex flex-wrap gap-1">
            <SmallToggle active={element.bold} onPress={() => onChange({ bold: !element.bold } as Partial<TextElement>)}><Bold className="h-3.5 w-3.5" /></SmallToggle>
            <SmallToggle active={element.italic} onPress={() => onChange({ italic: !element.italic } as Partial<TextElement>)}><Italic className="h-3.5 w-3.5" /></SmallToggle>
            <SmallToggle active={element.underline} onPress={() => onChange({ underline: !element.underline } as Partial<TextElement>)}><Underline className="h-3.5 w-3.5" /></SmallToggle>
          </div>
          <div className="flex flex-wrap gap-1">
            {(["left", "center", "right"] as const).map((a) => (
              <SmallToggle key={a} active={element.align === a} onPress={() => onChange({ align: a } as Partial<TextElement>)}>
                <span className="text-[9px] font-bold uppercase">{a[0]}</span>
              </SmallToggle>
            ))}
          </div>
          <ColorField label="Text color" value={element.color ?? "#111827"} onChange={(v) => onChange({ color: v } as Partial<TextElement>)} />
          <ColorField label="Background" value={element.bg ?? "#ffffff00"} onChange={(v) => onChange({ bg: v } as Partial<TextElement>)} />
        </>
      )}

      {element.type === "image" && (
        <div className="space-y-1">
          <Label>Image URL</Label>
          <input
            type="text"
            value={element.src}
            onChange={(e) => onChange({ src: e.target.value } as Partial<ImageElement>)}
            className="w-full rounded border border-app bg-app px-2 py-1 text-xs"
          />
          <Label>Alt text</Label>
          <input
            type="text"
            value={element.alt ?? ""}
            onChange={(e) => onChange({ alt: e.target.value } as Partial<ImageElement>)}
            className="w-full rounded border border-app bg-app px-2 py-1 text-xs"
          />
        </div>
      )}

      {element.type === "shape" && (
        <>
          <ColorField label="Fill" value={element.fill ?? "#60a5fa"} onChange={(v) => onChange({ fill: v } as Partial<ShapeElement>)} />
          <ColorField label="Stroke" value={element.stroke ?? "#1d4ed8"} onChange={(v) => onChange({ stroke: v } as Partial<ShapeElement>)} />
          <NumberField label="Stroke width" value={element.strokeWidth ?? 2} onChange={(v) => onChange({ strokeWidth: v } as Partial<ShapeElement>)} />
        </>
      )}
    </div>
  );
}

function SlideInspector({
  slide,
  onChange,
}: {
  slide: Slide | undefined;
  onChange: (patch: Partial<Slide>) => void;
}) {
  if (!slide) return null;
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-app-faint">Slide</h3>
      <ColorField
        label="Background"
        value={slide.background}
        onChange={(v) => onChange({ background: v })}
      />
      <p className="text-[11px] text-app-faint">
        Click an element to edit its properties. Double-click text to type. Drag corners to resize.
      </p>
    </div>
  );
}

/* ── Present mode ────────────────────────────────────────────────── */

function PresentMode({
  deck, activeIdx, onClose, onNext, onPrev,
}: {
  deck: Deck;
  activeIdx: number;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
}) {
  const slide = deck.slides[activeIdx];
  if (!slide) return null;
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black">
      <button
        onClick={onClose}
        className="absolute right-4 top-4 z-10 rounded-md bg-white/10 px-3 py-1 text-xs text-white hover:bg-white/20"
      >
        Exit (Esc)
      </button>
      <button
        onClick={onPrev}
        className="absolute left-4 top-1/2 z-10 -translate-y-1/2 rounded-md bg-white/10 px-3 py-2 text-white hover:bg-white/20"
      >
        ‹
      </button>
      <button
        onClick={onNext}
        className="absolute right-4 top-1/2 z-10 -translate-y-1/2 rounded-md bg-white/10 px-3 py-2 text-white hover:bg-white/20"
      >
        ›
      </button>
      <div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs text-white/80">
        {activeIdx + 1} / {deck.slides.length}
      </div>
      <div
        className="relative aspect-[16/9] w-[min(100vw,calc(100vh*16/9))] overflow-hidden"
        style={{ background: slide.background }}
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{
            width: CANVAS_W,
            height: CANVAS_H,
            transform: `scale(${Math.min(window.innerWidth / CANVAS_W, window.innerHeight / CANVAS_H)})`,
          }}
        >
          {slide.elements.map((el) => (
            <div
              key={el.id}
              style={{
                position: "absolute",
                left: el.x, top: el.y, width: el.w, height: el.h,
                transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
              }}
            >
              {el.type === "text" && (
                <div
                  className="h-full w-full whitespace-pre-wrap break-words p-2"
                  style={{
                    fontSize: el.fontSize,
                    fontFamily: el.fontFamily,
                    fontWeight: el.bold ? 700 : 400,
                    fontStyle: el.italic ? "italic" : "normal",
                    textDecoration: el.underline ? "underline" : "none",
                    color: el.color ?? "#111827",
                    textAlign: el.align ?? "left",
                    background: el.bg ?? "transparent",
                  }}
                >
                  {el.text}
                </div>
              )}
              {el.type === "image" && (
                <img src={el.src} alt={el.alt ?? ""} className="h-full w-full object-cover" />
              )}
              {el.type === "shape" && (
                <div
                  className="h-full w-full"
                  style={{
                    background: el.fill ?? "#60a5fa",
                    border: el.strokeWidth ? `${el.strokeWidth}px solid ${el.stroke ?? "#1d4ed8"}` : undefined,
                    borderRadius: el.shape === "ellipse" ? "50%" : "4px",
                  }}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Thumbnails ──────────────────────────────────────────────────── */

function ThumbCanvas({ slide }: { slide: Slide }) {
  return (
    <div
      className="relative overflow-hidden"
      style={{
        aspectRatio: "16/9",
        background: slide.background,
      }}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: `scale(${160 / CANVAS_W})`,
        }}
      >
        {slide.elements.map((el) => (
          <div
            key={el.id}
            style={{
              position: "absolute",
              left: el.x, top: el.y, width: el.w, height: el.h,
              transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
            }}
          >
            {el.type === "text" && (
              <div
                className="h-full w-full overflow-hidden whitespace-pre-wrap break-words p-1"
                style={{
                  fontSize: el.fontSize,
                  fontFamily: el.fontFamily,
                  fontWeight: el.bold ? 700 : 400,
                  fontStyle: el.italic ? "italic" : "normal",
                  color: el.color ?? "#111827",
                  textAlign: el.align ?? "left",
                  background: el.bg ?? "transparent",
                }}
              >
                {el.text}
              </div>
            )}
            {el.type === "image" && <img src={el.src} alt="" className="h-full w-full object-cover" />}
            {el.type === "shape" && (
              <div
                className="h-full w-full"
                style={{
                  background: el.fill,
                  border: el.strokeWidth ? `${el.strokeWidth}px solid ${el.stroke ?? "#1d4ed8"}` : undefined,
                  borderRadius: el.shape === "ellipse" ? "50%" : "4px",
                }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── UI atoms ────────────────────────────────────────────────────── */

function ToolBtn({
  title, onPress, active, children,
}: {
  title: string;
  onPress: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onPress}
      className={`grid h-7 w-7 place-items-center rounded transition ${
        active
          ? "bg-accent-soft text-accent"
          : "text-app-muted hover:bg-app-overlay hover:text-app"
      }`}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span className="mx-1 h-5 w-px" style={{ backgroundColor: "var(--app-border-strong, #e5e7eb)" }} />;
}

function SmallToggle({
  active, onPress, children,
}: {
  active?: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onPress}
      className={`grid h-6 w-6 place-items-center rounded text-xs transition ${
        active ? "bg-accent text-accent-fg" : "border border-app bg-app text-app-muted hover:bg-app-hover"
      }`}
    >
      {children}
    </button>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-[10px] font-semibold uppercase text-app-faint">{children}</label>;
}

function NumberField({
  label, value, onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <input
        type="number"
        value={Math.round(value)}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="w-full rounded border border-app bg-app px-2 py-1 text-xs"
      />
    </div>
  );
}

function ColorField({
  label, value, onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value.startsWith("#") ? value.slice(0, 7) : "#ffffff"}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-10 cursor-pointer rounded border border-app"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 rounded border border-app bg-app px-2 py-1 font-mono text-[11px]"
        />
      </div>
    </div>
  );
}

/* ── Helpers ─────────────────────────────────────────────────────── */

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function freshSlide(layout: "blank" | "title" | "title-content" | "two-column", index: number): Slide {
  const id = uid();
  if (layout === "title") {
    return {
      id, background: "#ffffff",
      elements: [
        { id: uid(), type: "text", x: 100, y: 320, w: 1400, h: 200, text: "Title", fontSize: 88, fontFamily: FONTS[0], bold: true, align: "center" },
        { id: uid(), type: "text", x: 100, y: 540, w: 1400, h: 80, text: "Subtitle", fontSize: 32, fontFamily: FONTS[0], color: "#6b7280", align: "center" },
      ],
    };
  }
  if (layout === "title-content") {
    return {
      id, background: "#ffffff",
      elements: [
        { id: uid(), type: "text", x: 100, y: 80, w: 1400, h: 110, text: "Slide title", fontSize: 56, fontFamily: FONTS[0], bold: true },
        { id: uid(), type: "text", x: 100, y: 230, w: 1400, h: 600, text: "• Point one\n• Point two\n• Point three", fontSize: 32, fontFamily: FONTS[0] },
      ],
    };
  }
  if (layout === "two-column") {
    return {
      id, background: "#ffffff",
      elements: [
        { id: uid(), type: "text", x: 100, y: 80, w: 1400, h: 110, text: "Two-column slide", fontSize: 56, fontFamily: FONTS[0], bold: true },
        { id: uid(), type: "text", x: 100, y: 230, w: 680, h: 600, text: "Left column content…", fontSize: 28, fontFamily: FONTS[0] },
        { id: uid(), type: "text", x: 820, y: 230, w: 680, h: 600, text: "Right column content…", fontSize: 28, fontFamily: FONTS[0] },
      ],
    };
  }
  return { id, background: "#ffffff", elements: [] };
}

function parseDeck(text: string): Deck {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return { version: 2, slides: [freshSlide("title", 1)] };
  // JSON envelope (v2)
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed?.version === 2 && Array.isArray(parsed.slides)) return parsed;
    // Legacy v1 envelope: { slides: [{ title, bullets }] }
    if (Array.isArray(parsed?.slides) && parsed.slides[0]?.bullets !== undefined) {
      return {
        version: 2,
        slides: parsed.slides.map((s: { title?: string; bullets?: string[] }) => slideFromTitleBullets(s.title ?? "", s.bullets ?? [])),
      };
    }
  } catch { /* fall through */ }
  // Markdown-ish fallback (# Title -> new slide, lines underneath are bullets)
  const slides: Slide[] = [];
  let curTitle = "";
  let curBullets: string[] = [];
  const flush = () => {
    if (!curTitle && curBullets.length === 0) return;
    slides.push(slideFromTitleBullets(curTitle, curBullets));
    curTitle = ""; curBullets = [];
  };
  for (const line of trimmed.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith("# ")) { flush(); curTitle = t.slice(2); continue; }
    if (t.startsWith("- ") || t.startsWith("• ")) { curBullets.push(t.slice(2)); continue; }
    if (!curTitle) curTitle = t;
    else curBullets.push(t);
  }
  flush();
  return { version: 2, slides: slides.length ? slides : [freshSlide("title", 1)] };
}

function slideFromTitleBullets(title: string, bullets: string[]): Slide {
  const id = uid();
  const elements: SlideElement[] = [];
  if (title) {
    elements.push({
      id: uid(), type: "text", x: 100, y: 80, w: 1400, h: 110,
      text: title, fontSize: 56, fontFamily: FONTS[0], bold: true,
    });
  }
  if (bullets.length > 0) {
    elements.push({
      id: uid(), type: "text", x: 100, y: 230, w: 1400, h: 600,
      text: bullets.map((b) => `• ${b}`).join("\n"),
      fontSize: 32, fontFamily: FONTS[0],
    });
  }
  return { id, background: "#ffffff", elements };
}
