"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AnimatedWordRenderer,
  WordCloud,
  useTooltip,
  type FinalWordData,
  type TooltipRendererData,
  type TooltipRenderer,
  type Word,
  type WordRenderer,
  type WordRendererData,
} from "@isoterik/react-word-cloud";
import type { Ref } from "react";

import { ZoomIn, ZoomOut, RotateCcw } from "lucide-react";

import type { KeywordInsight } from "@/types";
import { CATEGORY_COLORS } from "./categoryColors";
import { computeWordFontSize, getWordAnimationDelay } from "./wordCloudScale";

const CLOUD_WIDTH = 960;
const CLOUD_HEIGHT = 560;
const CLOUD_PADDING = 4;
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 0.25;

export const WORD_CLOUD_COUNT_OPTIONS = [50, 100, 150, 250] as const;
export const DEFAULT_WORD_CLOUD_COUNT = 100;

const NO_ROTATION = () => 0;

function pluralize(count: number): string {
  return `${count} job${count === 1 ? "" : "s"}`;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

function KeywordTooltip({ data }: { data: TooltipRendererData }) {
  const { refs, floatingStyles } = useTooltip({ data, placement: "top" });
  if (!data.word) return null;
  /* eslint-disable react-hooks/refs -- useTooltip exposes callback refs and computed styles as render props. */
  return (
    <div
      ref={refs.setFloating}
      style={{
        background: "rgba(17, 24, 39, 0.95)",
        color: "#fff",
        padding: "6px 10px",
        borderRadius: "8px",
        fontSize: "12px",
        lineHeight: 1.4,
        whiteSpace: "nowrap",
        pointerEvents: "none",
        zIndex: 50,
        ...floatingStyles,
      }}
    >
      <span style={{ fontWeight: 600 }}>{data.word.text}</span>
      <span style={{ opacity: 0.75 }}> — {pluralize(data.word.value)}</span>
    </div>
  );
  /* eslint-enable react-hooks/refs */
}

const renderTooltip: TooltipRenderer = (data) => <KeywordTooltip data={data} />;

type AccessibleWordProps = {
  data: WordRendererData;
  wordRef?: Ref<SVGTextElement>;
  opacity: number;
  reducedMotion: boolean;
  animationDelay: number;
  onSelect: () => void;
};

function AccessibleWord({
  data,
  wordRef,
  opacity,
  reducedMotion,
  animationDelay,
  onSelect,
}: AccessibleWordProps) {
  const label = `${data.text}, ${pluralize(data.value)}`;
  return (
    <g
      tabIndex={0}
      role="button"
      aria-label={label}
      style={{ cursor: "pointer", opacity }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      onFocus={(event) => {
        event.currentTarget.style.opacity = "1";
        event.currentTarget.style.outline = "2px solid #111827";
        event.currentTarget.style.outlineOffset = "2px";
      }}
      onBlur={(event) => {
        event.currentTarget.style.opacity = String(opacity);
        event.currentTarget.style.outline = "none";
      }}
    >
      {reducedMotion ? (
        <text
          ref={wordRef}
          textAnchor="middle"
          transform={`translate(${data.x}, ${data.y}) rotate(${data.rotate})`}
          style={{
            fontFamily: data.font,
            fontSize: data.size,
            fontWeight: data.weight,
            fontStyle: data.style,
            fill: data.fill,
          }}
          onClick={(event) => data.onWordClick?.(data, data.index, event)}
          onMouseOver={(event) => data.onWordMouseOver?.(data, data.index, event)}
          onMouseOut={(event) => data.onWordMouseOut?.(data, data.index, event)}
        >
          {data.text}
        </text>
      ) : (
        <AnimatedWordRenderer
          ref={wordRef}
          data={data}
          animationDelay={animationDelay}
        />
      )}
    </g>
  );
}

type WordCloudClientProps = {
  keywords: KeywordInsight[];
  selectedKeyword?: string;
  onWordClick?: (keyword: string, category: string) => void;
};

export default function WordCloudClient({
  keywords,
  selectedKeyword,
  onWordClick,
}: WordCloudClientProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  // Force the actual webfont load before running d3-cloud: its canvas
  // measurement must use the same metrics the SVG renders with, otherwise
  // words overlap. (document.fonts.ready alone is not enough — it can
  // resolve before a lazily-requested family like Inter has loaded.)
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const done = () => {
      if (!cancelled) setFontsReady(true);
    };
    if (typeof document === "undefined" || !("fonts" in document)) {
      done();
      return;
    }
    const specs = ["10px Inter", "32px Inter", "64px Inter", "bold 32px Inter"];
    Promise.all(specs.map((spec) => document.fonts.load(spec).catch(() => [])))
      .then(done, done);
    const fallback = window.setTimeout(done, 2000);
    return () => {
      cancelled = true;
      window.clearTimeout(fallback);
    };
  }, []);

  const words: Word[] = useMemo(
    () => keywords.map((k) => ({ text: k.keyword, value: k.count })),
    [keywords],
  );

  const { minCount, maxCount } = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const k of keywords) {
      if (k.count < min) min = k.count;
      if (k.count > max) max = k.count;
    }
    return { minCount: min, maxCount: max };
  }, [keywords]);

  // Remount the cloud when the keyword set changes so the staggered
  // entrance animation replays visibly (no opacity gate hiding it).
  const signature = useMemo(
    () => keywords.map((k) => `${k.category}:${k.keyword}:${k.count}`).join("|"),
    [keywords],
  );

  // sqrt domain so long-tail terms stay distinguishable (d3-cloud default).
  const fontSize = useMemo(() => {
    if (!Number.isFinite(minCount) || maxCount === minCount) return 30;
    return (word: Word) => computeWordFontSize(word.value, minCount, maxCount);
  }, [minCount, maxCount]);

  const opacityOf = useCallback((count: number): number => {
    if (!Number.isFinite(minCount) || maxCount === minCount) return 1;
    const normalized = (count - minCount) / (maxCount - minCount);
    return 0.9 + normalized * 0.1;
  }, [maxCount, minCount]);

  const isDimmed = useCallback(
    (index: number) => {
      const keyword = keywords[index];
      if (selectedKeyword && keyword?.keyword !== selectedKeyword) return true;
      if (hoveredIndex !== null && hoveredIndex !== index) return true;
      return false;
    },
    [hoveredIndex, keywords, selectedKeyword],
  );

  const renderWord: WordRenderer = useCallback(
    (data, ref) => {
      const base = opacityOf(data.value);
      const opacity = isDimmed(data.index) ? Math.min(base, 0.35) : base;
      return (
        <AccessibleWord
          data={data}
          wordRef={ref}
          opacity={opacity}
          reducedMotion={reducedMotion}
          animationDelay={getWordAnimationDelay(data.index)}
          onSelect={() => {
            const keyword = keywords[data.index];
            if (keyword) onWordClick?.(keyword.keyword, keyword.category);
          }}
        />
      );
    },
    [isDimmed, keywords, onWordClick, opacityOf, reducedMotion],
  );

  const handleWordClick = useCallback(
    (_word: FinalWordData, index: number) => {
      const keyword = keywords[index];
      if (keyword) onWordClick?.(keyword.keyword, keyword.category);
    },
    [keywords, onWordClick],
  );
  const handleWordMouseOver = useCallback(
    (_word: FinalWordData, index: number) => setHoveredIndex(index),
    [],
  );
  const handleWordMouseOut = useCallback(() => setHoveredIndex(null), []);
  const zoomIn = useCallback(
    () => setZoom((z) => Math.min(ZOOM_MAX, Math.round((z + ZOOM_STEP) * 100) / 100)),
    [],
  );
  const zoomOut = useCallback(
    () => setZoom((z) => Math.max(ZOOM_MIN, Math.round((z - ZOOM_STEP) * 100) / 100)),
    [],
  );
  const resetZoom = useCallback(() => {
    setZoom(1);
  }, []);
  const fill = useCallback(
    (_word: Word, index: number) =>
      CATEGORY_COLORS[keywords[index]?.category ?? ""] ?? "#374151",
    [keywords],
  );
  if (!keywords.length) {
    return (
      <div className="flex h-64 items-center justify-center text-gray-400">
        No data available for this category.
      </div>
    );
  }

  if (!fontsReady) {
    return (
      <div
        aria-label="Loading word cloud"
        className="flex h-64 items-center justify-center text-gray-400"
      >
        Loading word cloud…
      </div>
    );
  }

  return (
    <div>
      <div
        className="mb-2 flex items-center justify-end gap-1"
        role="group"
        aria-label="Word cloud zoom controls"
      >
        <span aria-live="polite" className="mr-1 text-xs text-gray-500">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={zoomOut}
          disabled={zoom <= ZOOM_MIN}
          aria-label="Zoom word cloud out"
          className="rounded-md border border-gray-300 bg-white p-1.5 text-gray-600 transition-colors hover:border-blue-400 disabled:opacity-40"
        >
          <ZoomOut className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={zoomIn}
          disabled={zoom >= ZOOM_MAX}
          aria-label="Zoom word cloud in"
          className="rounded-md border border-gray-300 bg-white p-1.5 text-gray-600 transition-colors hover:border-blue-400 disabled:opacity-40"
        >
          <ZoomIn className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={resetZoom}
          disabled={zoom === 1}
          aria-label="Reset word cloud zoom"
          className="rounded-md border border-gray-300 bg-white p-1.5 text-gray-600 transition-colors hover:border-blue-400 disabled:opacity-40"
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="overflow-hidden">
        <div
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: "center center",
            transition: reducedMotion ? "none" : "transform .2s ease",
          }}
        >
          <WordCloud
            key={signature}
            words={words}
            width={CLOUD_WIDTH}
            height={CLOUD_HEIGHT}
            timeInterval={16}
            spiral="archimedean"
            padding={CLOUD_PADDING}
            font="Inter, ui-sans-serif, system-ui, sans-serif"
            fontSize={fontSize}
            rotate={NO_ROTATION}
            fill={fill}
            transition={reducedMotion ? "none" : "all .3s ease"}
            enableTooltip
            renderTooltip={renderTooltip}
            renderWord={renderWord}
            onWordClick={handleWordClick}
            onWordMouseOver={handleWordMouseOver}
            onWordMouseOut={handleWordMouseOut}
            svgProps={{
              className: "h-auto w-full",
              role: "group",
              "aria-label":
                "Keyword word cloud. Activate a word to filter jobs mentioning it.",
            }}
          />
        </div>
      </div>
    </div>
  );
}
