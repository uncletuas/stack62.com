import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Stage, Layer, Rect, Text, Image as KonvaImage } from "react-konva";
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
import Konva from "konva";

const CANVAS_W = 1600;
const CANVAS_H = 900;

type ElementBase = {
  id: string;
  type: "text" | "image" | "shape";
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

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function freshSlide(layout: "blank" | "title" | "title-content" | "two-column", index: number): Slide {
  const id = uid();
  if (layout === "title") {
    return {
      id,
      background: "#ffffff",
      elements: [
        {
          id: uid(),
          type: "text",
          x: 100,
          y: 320,
          w: 1400,
          h: 200,
          text: "Title",
          fontSize: 88,
          fontFamily: FONTS[0],
          bold: true,
          align: "center",
          color: "#1f1f1f",
        },
        {
          id: uid(),
          type: "text",
          x: 100,
          y: 540,
          w: 1400,
          h: 80,
          text: "Subtitle",
          fontSize: 32,
          fontFamily: FONTS[0],
          color: "#6b7280",
          align: "center",
        },
      ],
    };
  }
  if (layout === "title-content") {
    return {
      id,
      background: "#ffffff",
      elements: [
        {
          id: uid(),
          type: "text",
          x: 100,
          y: 80,
          w: 1400,
          h: 110,
          text: "Slide title",
          fontSize: 56,
          fontFamily: FONTS[0],
          bold: true,
          color: "#1f1f1f",
        },
        {
          id: uid(),
          type: "text",
          x: 100,
          y: 230,
          w: 1400,
          h: 600,
          text: "• Point one\n• Point two\n• Point three",
          fontSize: 32,
          fontFamily: FONTS[0],
          color: "#1f1f1f",
        },
      ],
    };
  }
  if (layout === "two-column") {
    return {
      id,
      background: "#ffffff",
      elements: [
        {
          id: uid(),
          type: "text",
          x: 100,
          y: 80,
          w: 1400,
          h: 110,
          text: "Two-column slide",
          fontSize: 56,
          fontFamily: FONTS[0],
          bold: true,
          color: "#1f1f1f",
        },
        {
          id: uid(),
          type: "text",
          x: 100,
          y: 230,
          w: 680,
          h: 600,
          text: "Left column content...",
          fontSize: 28,
          fontFamily: FONTS[0],
          color: "#1f1f1f",
        },
        {
          id: uid(),
          type: "text",
          x: 820,
          y: 230,
          w: 680,
          h: 600,
          text: "Right column content...",
          fontSize: 28,
          fontFamily: FONTS[0],
          color: "#1f1f1f",
        },
      ],
    };
  }
  return { id, background: "#ffffff", elements: [] };
}

function parseDeck(text: string): Deck {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return { version: 2, slides: [freshSlide("title", 1)] };
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed?.version === 2 && Array.isArray(parsed.slides)) return parsed;
  } catch {
    // Fall through
  }
  const slides: Slide[] = [];
  const chunks = trimmed.split(/\n\s*--- slide ---\s*\n/i);
  chunks.forEach((chunk) => {
    const lines = chunk.split(/\r?\n/);
    if (lines.length > 0) {
      slides.push(freshSlide("title-content", slides.length + 1));
    }
  });
  return { version: 2, slides: slides.length ? slides : [freshSlide("title", 1)] };
}

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
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [presenting, setPresenting] = useState(false);
  const lastEmittedRef = useRef<string>("");
  const stageRef = useRef<Konva.Stage>(null);
  const [stageScale, setStageScale] = useState(1);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const [imageCache, setImageCache] = useState<Record<string, HTMLImageElement>>({});

  useEffect(() => {
    if (text === lastEmittedRef.current) return;
    setDeck(parseDeck(text));
  }, [text]);

  // Preload every image referenced by the deck (e.g. imported from a
  // .pptx as base64) into the cache so it renders on the Konva canvas, not
  // just in the HTML thumbnails. A ref tracks in-flight/loaded srcs so we
  // never kick off a duplicate load.
  const requestedSrcsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    for (const slide of deck.slides) {
      for (const el of slide.elements) {
        if (el.type !== "image" || !el.src) continue;
        if (requestedSrcsRef.current.has(el.src)) continue;
        requestedSrcsRef.current.add(el.src);
        const src = el.src;
        const img = new window.Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          if (!cancelled) setImageCache((prev) => ({ ...prev, [src]: img }));
        };
        img.src = src;
      }
    }
    return () => {
      cancelled = true;
    };
  }, [deck]);

  const emit = useCallback((newDeck: Deck) => {
    const serialized = JSON.stringify(newDeck);
    lastEmittedRef.current = serialized;
    onChange(serialized);
  }, [onChange]);

  const updateElement = useCallback(
    (id: string, patch: Partial<SlideElement>) => {
      setDeck((prev) => {
        const newSlides = [...prev.slides];
        const slide = { ...newSlides[activeIndex] };
        slide.elements = slide.elements.map((el) =>
          el.id === id ? { ...el, ...patch } : el
        );
        newSlides[activeIndex] = slide;
        const newDeck = { ...prev, slides: newSlides };
        emit(newDeck);
        return newDeck;
      });
    },
    [activeIndex, emit]
  );

  const addElement = useCallback(
    (el: SlideElement) => {
      setDeck((prev) => {
        const newSlides = [...prev.slides];
        const slide = { ...newSlides[activeIndex] };
        slide.elements = [...slide.elements, el];
        newSlides[activeIndex] = slide;
        const newDeck = { ...prev, slides: newSlides };
        emit(newDeck);
        return newDeck;
      });
      setSelectedId(el.id);
    },
    [activeIndex, emit]
  );

  const deleteElement = useCallback(
    (id: string) => {
      setDeck((prev) => {
        const newSlides = [...prev.slides];
        const slide = { ...newSlides[activeIndex] };
        slide.elements = slide.elements.filter((el) => el.id !== id);
        newSlides[activeIndex] = slide;
        const newDeck = { ...prev, slides: newSlides };
        emit(newDeck);
        return newDeck;
      });
      setSelectedId((cur) => (cur === id ? null : cur));
    },
    [activeIndex, emit]
  );

  const addSlide = (layout: "blank" | "title" | "title-content" | "two-column" = "blank") => {
    setDeck((prev) => {
      const newSlide = freshSlide(layout, prev.slides.length + 1);
      const newDeck = { ...prev, slides: [...prev.slides, newSlide] };
      emit(newDeck);
      return newDeck;
    });
    setActiveIndex(deck.slides.length);
    setSelectedId(null);
  };

  const duplicateSlide = () => {
    setDeck((prev) => {
      const cur = prev.slides[activeIndex];
      if (!cur) return prev;
      const copy: Slide = {
        ...cur,
        id: uid(),
        elements: cur.elements.map((el) => ({ ...el, id: uid() })),
      };
      const slides = [...prev.slides];
      slides.splice(activeIndex + 1, 0, copy);
      const newDeck = { ...prev, slides };
      emit(newDeck);
      return newDeck;
    });
    setActiveIndex((cur) => cur + 1);
  };

  const removeSlide = (index: number) => {
    if (deck.slides.length <= 1) return;
    setDeck((prev) => {
      const slides = prev.slides.filter((_, i) => i !== index);
      const newDeck = { ...prev, slides };
      emit(newDeck);
      return newDeck;
    });
    setActiveIndex((cur) => Math.max(0, Math.min(cur, deck.slides.length - 2)));
  };

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
      color: "#1f1f1f",
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
    const img = new window.Image();
    img.src = url;
    img.crossOrigin = "anonymous";
    img.onload = () => {
      setImageCache((prev) => ({ ...prev, [url]: img }));
      addElement({
        id: uid(),
        type: "image",
        x: 400,
        y: 200,
        w: 800,
        h: 500,
        src: url,
      });
    };
  };

  const insertShape = (shape: "rect" | "ellipse") => {
    addElement({
      id: uid(),
      type: "shape",
      shape,
      x: 500,
      y: 300,
      w: 600,
      h: 300,
      fill: "#60a5fa",
      stroke: "#1d4ed8",
      strokeWidth: 2,
    });
  };

  useEffect(() => {
    const computeScale = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      setContainerSize({ width: rect.width, height: rect.height });
      const scaleX = (rect.width - 32) / CANVAS_W;
      const scaleY = (rect.height - 32) / CANVAS_H;
      setStageScale(Math.max(0.05, Math.min(scaleX, scaleY, 1.5)));
    };
    computeScale();
    const resizeObserver = new ResizeObserver(computeScale);
    if (containerRef.current) resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  if (presenting) {
    return (
      <PresentMode
        deck={deck}
        activeIndex={activeIndex}
        onClose={() => setPresenting(false)}
        onNext={() => setActiveIndex((i) => Math.min(deck.slides.length - 1, i + 1))}
        onPrev={() => setActiveIndex((i) => Math.max(0, i - 1))}
      />
    );
  }

  const activeSlide = deck.slides[activeIndex];
  const selectedEl = activeSlide?.elements.find((el) => el.id === selectedId) ?? null;

  return (
    <div className="flex h-full flex-col bg-gray-100 text-gray-800">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1 border-b border-gray-300 bg-white px-3 py-2">
        <button
          onClick={() => addSlide("blank")}
          className="flex items-center gap-1.5 rounded-md bg-blue-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-600"
        >
          <Plus className="h-3.5 w-3.5" /> New slide
        </button>
        <select
          onChange={(e) => {
            addSlide(e.target.value as any);
            e.currentTarget.value = "";
          }}
          className="h-7 rounded border border-gray-300 bg-white px-2 text-xs text-gray-600"
          defaultValue=""
        >
          <option value="" disabled>Layout…</option>
          <option value="blank">Blank</option>
          <option value="title">Title</option>
          <option value="title-content">Title + body</option>
          <option value="two-column">Two-column</option>
        </select>
        <div className="mx-1 h-5 w-px bg-gray-300" />
        <ToolbarButton icon={Type} label="Insert text" onClick={insertText} />
        <ToolbarButton icon={ImageIcon} label="Insert image" onClick={insertImage} />
        <ToolbarButton icon={Square} label="Insert rectangle" onClick={() => insertShape("rect")} />
        <ToolbarButton
          icon={GalleryHorizontal}
          label="Insert ellipse"
          onClick={() => insertShape("ellipse")}
        />
        <div className="mx-1 h-5 w-px bg-gray-300" />
        <ToolbarButton icon={Copy} label="Duplicate slide" onClick={duplicateSlide} />
        <ToolbarButton icon={Trash2} label="Delete slide" onClick={() => removeSlide(activeIndex)} />
        <div className="mx-1 h-5 w-px bg-gray-300" />
        <button
          onClick={() => setPresenting(true)}
          className="flex items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
        >
          <Presentation className="h-3.5 w-3.5" />
          Present
        </button>
        <div className="ml-auto flex items-center gap-2">
          {title && <span className="text-xs text-gray-500">{title}</span>}
        </div>
      </div>

      {/* Main content */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Thumbnails */}
        <aside className="w-44 shrink-0 overflow-y-auto border-r border-gray-300 bg-white p-2">
          {deck.slides.map((slide, i) => (
            <div
              key={slide.id}
              className={`relative mb-2 cursor-pointer overflow-hidden rounded border ${
                i === activeIndex ? "border-blue-500 ring-2 ring-blue-500/30" : "border-gray-300"
              }`}
              onClick={() => {
                setActiveIndex(i);
                setSelectedId(null);
              }}
            >
              <div className="flex items-center justify-between gap-1 bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-500">
                <span>{i + 1}</span>
                {deck.slides.length > 1 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeSlide(i);
                    }}
                    className="rounded p-0.5 text-gray-400 hover:bg-red-100 hover:text-red-600"
                    title="Delete slide"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </button>
                )}
              </div>
              <div className="relative" style={{ aspectRatio: "16/9", background: slide.background }}>
                <div
                  className="absolute left-0 top-0 origin-top-left"
                  style={{ width: CANVAS_W, height: CANVAS_H, transform: `scale(${160 / CANVAS_W})` }}
                >
                  {slide.elements.map((el) => (
                    <div
                      key={el.id}
                      style={{
                        position: "absolute",
                        left: el.x,
                        top: el.y,
                        width: el.w,
                        height: el.h,
                        transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
                        overflow: "hidden",
                      }}
                    >
                      {el.type === "text" && (
                        <div
                          style={{
                            fontSize: el.fontSize,
                            fontFamily: el.fontFamily,
                            fontWeight: el.bold ? "bold" : "normal",
                            fontStyle: el.italic ? "italic" : "normal",
                            color: el.color || "#1f1f1f",
                            textAlign: el.align || "left",
                            backgroundColor: el.bg || "transparent",
                          }}
                        >
                          {el.text}
                        </div>
                      )}
                      {el.type === "image" && <img src={el.src} alt="" className="h-full w-full object-cover" />}
                      {el.type === "shape" && (
                        <div
                          style={{
                            width: "100%",
                            height: "100%",
                            background: el.fill || "#60a5fa",
                            border: el.strokeWidth ? `${el.strokeWidth}px solid ${el.stroke || "#1d4ed8"}` : undefined,
                            borderRadius: el.shape === "ellipse" ? "50%" : "4px",
                          }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
          <button
            onClick={() => addSlide("blank")}
            className="flex w-full items-center justify-center gap-1 rounded border border-dashed border-gray-300 py-2 text-[11px] text-gray-500 hover:bg-gray-100 hover:text-gray-800"
          >
            <Plus className="h-3 w-3" /> Add slide
          </button>
        </aside>

        {/* Stage */}
        <div
          ref={containerRef}
          className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-gray-200 p-4"
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
            <Stage
              ref={stageRef}
              width={CANVAS_W}
              height={CANVAS_H}
              scaleX={stageScale}
              scaleY={stageScale}
              style={{ background: activeSlide?.background || "#ffffff" }}
            >
              <Layer>
                {activeSlide?.elements.map((el) => (
                  <ElementView
                    key={el.id}
                    element={el}
                    selected={el.id === selectedId}
                    onSelect={() => setSelectedId(el.id)}
                    onChange={(patch) => updateElement(el.id, patch)}
                    onDelete={() => deleteElement(el.id)}
                    imageCache={imageCache}
                  />
                ))}
              </Layer>
            </Stage>
          </div>
        </div>

        {/* Inspector */}
        <aside className="w-64 shrink-0 overflow-y-auto border-l border-gray-300 bg-white p-3 text-sm">
          {selectedEl ? (
            <Inspector
              element={selectedEl}
              onChange={(patch) => updateElement(selectedEl.id, patch)}
              onDelete={() => deleteElement(selectedEl.id)}
            />
          ) : (
            <SlideInspector
              slide={activeSlide}
              onChange={(patch) => {
                setDeck((prev) => {
                  const newSlides = [...prev.slides];
                  newSlides[activeIndex] = { ...newSlides[activeIndex], ...patch };
                  const newDeck = { ...prev, slides: newSlides };
                  emit(newDeck);
                  return newDeck;
                });
              }}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

function ElementView({
  element,
  selected,
  onSelect,
  onChange,
  onDelete,
  imageCache,
}: {
  element: SlideElement;
  selected: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<SlideElement>) => void;
  onDelete: () => void;
  imageCache: Record<string, HTMLImageElement>;
}) {
  const shapeRef = useRef<Konva.Shape>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);

  if (element.type === "text") {
    return (
      <Text
        ref={shapeRef as any}
        x={element.x}
        y={element.y}
        width={element.w}
        height={element.h}
        text={element.text}
        fontSize={element.fontSize}
        fontFamily={element.fontFamily}
        fontStyle={`${element.bold ? "bold" : "normal"} ${element.italic ? "italic" : "normal"}`}
        fill={element.color || "#1f1f1f"}
        align={element.align || "left"}
        draggable={!isResizing}
        onMouseDown={() => onSelect()}
        onDragStart={() => setIsDragging(true)}
        onDragEnd={(e) => {
          onChange({ x: e.target.x(), y: e.target.y() });
          setIsDragging(false);
        }}
        transformEnabled={selected}
        onTransformEnd={(e) => {
          const node = e.target as Konva.Node;
          onChange({
            x: node.x(),
            y: node.y(),
            w: node.width() * node.scaleX(),
            h: node.height() * node.scaleY(),
            rotation: node.rotation(),
          });
        }}
      />
    );
  }

  if (element.type === "image") {
    return (
      <KonvaImage
        ref={shapeRef as any}
        x={element.x}
        y={element.y}
        width={element.w}
        height={element.h}
        image={imageCache[element.src]}
        draggable={!isResizing}
        onMouseDown={() => onSelect()}
        onDragStart={() => setIsDragging(true)}
        onDragEnd={(e) => {
          onChange({ x: e.target.x(), y: e.target.y() });
          setIsDragging(false);
        }}
        transformEnabled={selected}
        onTransformEnd={(e) => {
          const node = e.target as Konva.Node;
          onChange({
            x: node.x(),
            y: node.y(),
            w: node.width() * node.scaleX(),
            h: node.height() * node.scaleY(),
            rotation: node.rotation(),
          });
        }}
      />
    );
  }

  if (element.type === "shape") {
    return element.shape === "rect" ? (
      <Rect
        ref={shapeRef as any}
        x={element.x}
        y={element.y}
        width={element.w}
        height={element.h}
        fill={element.fill || "#60a5fa"}
        stroke={element.stroke || "#1d4ed8"}
        strokeWidth={element.strokeWidth || 2}
        draggable={!isResizing}
        onMouseDown={() => onSelect()}
        onDragStart={() => setIsDragging(true)}
        onDragEnd={(e) => {
          onChange({ x: e.target.x(), y: e.target.y() });
          setIsDragging(false);
        }}
        transformEnabled={selected}
        onTransformEnd={(e) => {
          const node = e.target as Konva.Node;
          onChange({
            x: node.x(),
            y: node.y(),
            w: node.width() * node.scaleX(),
            h: node.height() * node.scaleY(),
            rotation: node.rotation(),
          });
        }}
      />
    ) : (
      <Konva.Ellipse
        ref={shapeRef as any}
        x={element.x + element.w / 2}
        y={element.y + element.h / 2}
        radiusX={element.w / 2}
        radiusY={element.h / 2}
        fill={element.fill || "#60a5fa"}
        stroke={element.stroke || "#1d4ed8"}
        strokeWidth={element.strokeWidth || 2}
        draggable={!isResizing}
        onMouseDown={() => onSelect()}
        onDragStart={() => setIsDragging(true)}
        onDragEnd={(e) => {
          onChange({ x: e.target.x() - element.w / 2, y: e.target.y() - element.h / 2 });
          setIsDragging(false);
        }}
        transformEnabled={selected}
        onTransformEnd={(e) => {
          const node = e.target as Konva.Node;
          onChange({
            x: node.x() - (node.width() * node.scaleX()) / 2,
            y: node.y() - (node.height() * node.scaleY()) / 2,
            w: node.width() * node.scaleX(),
            h: node.height() * node.scaleY(),
            rotation: node.rotation(),
          });
        }}
      />
    );
  }

  return null;
}

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
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          {element.type === "text" ? "Text" : element.type === "image" ? "Image" : "Shape"}
        </h3>
        <button onClick={onDelete} className="text-xs text-red-600 hover:underline" title="Delete">
          Delete
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="X"
          value={element.x}
          onChange={(v) => onChange({ x: v })}
        />
        <NumberField
          label="Y"
          value={element.y}
          onChange={(v) => onChange({ y: v })}
        />
        <NumberField
          label="W"
          value={element.w}
          onChange={(v) => onChange({ w: v })}
        />
        <NumberField
          label="H"
          value={element.h}
          onChange={(v) => onChange({ h: v })}
        />
      </div>

      {element.type === "text" && (
        <>
          <div className="space-y-1">
            <Label>Font</Label>
            <select
              value={element.fontFamily}
              onChange={(e) => onChange({ fontFamily: e.target.value } as any)}
              className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs"
            >
              {FONTS.map((f) => (
                <option key={f} value={f}>
                  {f.replace(/['"]/g, "").split(",")[0]}
                </option>
              ))}
            </select>
          </div>
          <NumberField
            label="Size (px)"
            value={element.fontSize}
            onChange={(v) => onChange({ fontSize: v } as any)}
          />
          <div className="flex flex-wrap gap-1">
            <SmallToggle
              active={element.bold}
              onPress={() => onChange({ bold: !element.bold } as any)}
            >
              <Bold className="h-3.5 w-3.5" />
            </SmallToggle>
            <SmallToggle
              active={element.italic}
              onPress={() => onChange({ italic: !element.italic } as any)}
            >
              <Italic className="h-3.5 w-3.5" />
            </SmallToggle>
            <SmallToggle
              active={element.underline}
              onPress={() => onChange({ underline: !element.underline } as any)}
            >
              <Underline className="h-3.5 w-3.5" />
            </SmallToggle>
          </div>
          <div className="flex flex-wrap gap-1">
            {(["left", "center", "right"] as const).map((a) => (
              <SmallToggle
                key={a}
                active={element.align === a}
                onPress={() => onChange({ align: a } as any)}
              >
                <span className="text-[9px] font-bold uppercase">{a[0]}</span>
              </SmallToggle>
            ))}
          </div>
          <ColorField
            label="Text color"
            value={element.color || "#1f1f1f"}
            onChange={(v) => onChange({ color: v } as any)}
          />
          <ColorField
            label="Background"
            value={element.bg || "#ffffff00"}
            onChange={(v) => onChange({ bg: v } as any)}
          />
        </>
      )}

      {element.type === "image" && (
        <div className="space-y-1">
          <Label>Image URL</Label>
          <input
            type="text"
            value={element.src}
            onChange={(e) => onChange({ src: e.target.value } as any)}
            className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs"
          />
          <Label>Alt text</Label>
          <input
            type="text"
            value={element.alt || ""}
            onChange={(e) => onChange({ alt: e.target.value } as any)}
            className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs"
          />
        </div>
      )}

      {element.type === "shape" && (
        <>
          <ColorField
            label="Fill"
            value={element.fill || "#60a5fa"}
            onChange={(v) => onChange({ fill: v } as any)}
          />
          <ColorField
            label="Stroke"
            value={element.stroke || "#1d4ed8"}
            onChange={(v) => onChange({ stroke: v } as any)}
          />
          <NumberField
            label="Stroke width"
            value={element.strokeWidth || 2}
            onChange={(v) => onChange({ strokeWidth: v } as any)}
          />
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
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Slide</h3>
      <ColorField
        label="Background"
        value={slide.background}
        onChange={(v) => onChange({ background: v })}
      />
      <p className="text-[11px] text-gray-500">
        Click an element to edit its properties.
      </p>
    </div>
  );
}

function PresentMode({
  deck,
  activeIndex,
  onClose,
  onNext,
  onPrev,
}: {
  deck: Deck;
  activeIndex: number;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
}) {
  const slide = deck.slides[activeIndex];
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        onNext();
      }
      if (e.key === "ArrowLeft") {
        onPrev();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, onNext, onPrev]);
  const scale = Math.min(window.innerWidth / CANVAS_W, window.innerHeight / CANVAS_H);

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
        {activeIndex + 1} / {deck.slides.length}
      </div>
      <div
        className="relative aspect-[16/9] w-[min(100vw,calc(100vh*16/9))] overflow-hidden"
        style={{ background: slide?.background }}
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{ width: CANVAS_W, height: CANVAS_H, transform: `scale(${scale})` }}
        >
          {slide?.elements.map((el) => (
            <div
              key={el.id}
              style={{
                position: "absolute",
                left: el.x,
                top: el.y,
                width: el.w,
                height: el.h,
                transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
                overflow: "hidden",
              }}
            >
              {el.type === "text" && (
                <div
                  style={{
                    fontSize: el.fontSize,
                    fontFamily: el.fontFamily,
                    fontWeight: el.bold ? "bold" : "normal",
                    fontStyle: el.italic ? "italic" : "normal",
                    color: el.color || "#1f1f1f",
                    textAlign: el.align || "left",
                    backgroundColor: el.bg || "transparent",
                  }}
                >
                  {el.text}
                </div>
              )}
              {el.type === "image" && <img src={el.src} alt="" className="h-full w-full object-cover" />}
              {el.type === "shape" && (
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    background: el.fill || "#60a5fa",
                    border: el.strokeWidth ? `${el.strokeWidth}px solid ${el.stroke || "#1d4ed8"}` : undefined,
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

function ToolbarButton({ icon: Icon, label, onClick }: { icon: any; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded text-gray-600 hover:bg-gray-100"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function SmallToggle({
  active,
  onPress,
  children,
}: {
  active?: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onPress}
      className={`flex h-6 w-6 items-center justify-center rounded text-xs transition ${
        active ? "bg-blue-500 text-white" : "border border-gray-300 bg-white text-gray-600 hover:bg-gray-100"
      }`}
    >
      {children}
    </button>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-[10px] font-semibold uppercase text-gray-500">{children}</label>;
}

function NumberField({
  label,
  value,
  onChange,
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
        className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs"
      />
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
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
          className="h-7 w-10 cursor-pointer rounded border border-gray-300"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 rounded border border-gray-300 bg-white px-2 py-1 font-mono text-[11px]"
        />
      </div>
    </div>
  );
}
