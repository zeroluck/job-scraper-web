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

import type { KeywordInsight } from "@/types";
import { CATEGORY_COLORS } from "./categoryColors";

const CLOUD_WIDTH = 960;
const CLOUD_HEIGHT = 500;

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
  onWordClick?: (keyword: string, category: string) => void;
};

export default function WordCloudClient({
  keywords,
  onWordClick,
}: WordCloudClientProps) {
  const reducedMotion = usePrefersReducedMotion();

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

  // Opacity cross-fade while d3-cloud recomputes: hide on input change,
  // reveal on completion. No spring layout interpolation by design.
  const signature = useMemo(
    () => keywords.map((k) => `${k.category}:${k.keyword}:${k.count}`).join("|"),
    [keywords],
  );
  const [visibleSignature, setVisibleSignature] = useState<string | null>(null);
  useEffect(() => {
    setVisibleSignature(null);
  }, [signature]);

  const fontSize = useMemo(() => {
    if (!Number.isFinite(minCount) || maxCount === minCount) return 30;
    return (word: Word) => {
      const normalized = (word.value - minCount) / (maxCount - minCount);
      return Math.round(14 + normalized * 42);
    };
  }, [minCount, maxCount]);

  const opacityOf = useCallback((count: number): number => {
    if (!Number.isFinite(minCount) || maxCount === minCount) return 1;
    const normalized = (count - minCount) / (maxCount - minCount);
    return 0.9 + normalized * 0.1;
  }, [maxCount, minCount]);

  const renderWord: WordRenderer = useCallback(
    (data, ref) => (
      <AccessibleWord
        data={data}
        wordRef={ref}
        opacity={opacityOf(data.value)}
        reducedMotion={reducedMotion}
        animationDelay={data.index * 10}
        onSelect={() => {
          const keyword = keywords[data.index];
          if (keyword) onWordClick?.(keyword.keyword, keyword.category);
        }}
      />
    ),
    [keywords, onWordClick, opacityOf, reducedMotion],
  );

  const handleWordClick = useCallback(
    (_word: FinalWordData, index: number) => {
      const keyword = keywords[index];
      if (keyword) onWordClick?.(keyword.keyword, keyword.category);
    },
    [keywords, onWordClick],
  );
  const fill = useCallback(
    (_word: Word, index: number) =>
      CATEGORY_COLORS[keywords[index]?.category ?? ""] ?? "#374151",
    [keywords],
  );
  const handleComplete = useCallback(
    () => setVisibleSignature(signature),
    [signature],
  );

  if (!keywords.length) {
    return (
      <div className="flex h-64 items-center justify-center text-gray-400">
        No data available for this category.
      </div>
    );
  }

  return (
    <div
      className={`transition-opacity motion-safe:duration-300 ${
        visibleSignature === signature ? "opacity-100" : "opacity-0"
      }`}
    >
      <WordCloud
        words={words}
        width={CLOUD_WIDTH}
        height={CLOUD_HEIGHT}
        spiral="archimedean"
        padding={2}
        font="Inter, ui-sans-serif, system-ui, sans-serif"
        fontSize={fontSize}
        rotate={NO_ROTATION}
        fill={fill}
        transition={reducedMotion ? "none" : "all .3s ease"}
        enableTooltip
        renderTooltip={renderTooltip}
        renderWord={renderWord}
        onWordClick={handleWordClick}
        onCompleteComputation={handleComplete}
        svgProps={{
          className: "h-auto w-full",
          role: "group",
          "aria-label":
            "Keyword word cloud. Activate a word to filter jobs mentioning it.",
        }}
      />
    </div>
  );
}
