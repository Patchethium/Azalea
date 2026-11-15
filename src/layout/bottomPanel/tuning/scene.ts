import {
  driftBaseline,
  firstColumnAfter,
  isWhisper,
  type PitchMapping,
  pitchBadge,
  pitchPosition,
  resetTarget,
  type TuningColumn,
  type TuningPart,
} from "./layout";

/** Narrowest mora column that still shows the hovered pitch value. */
const PITCH_BADGE_WIDTH = 32;
const PITCH_BADGE_HEIGHT = 16;
const MORA_TEXT_MIN_WIDTH = 17;
const LATIN_CHAR_WIDTH = 9;
const ARROW_SIZE = 4;

export type TuningHover = { index: number; part: TuningPart } | null;

type SceneCell = {
  x: number;
  width: number;
  /** Null when the label does not fit the cell. */
  label: string | null;
  hovered: boolean;
};

export type ScenePitch = {
  y: number;
  hovered: boolean;
  /** The hovered span: up from the bottom, or from the prediction when relative. */
  fill: { top: number; bottom: number } | null;
  /** The dashed prediction line. */
  baselineY: number | null;
  /** Relative mode's dotted line at the absolute pitch, pinned to the scale. */
  ghost: { y: number; outOfRange: "above" | "below" | null } | null;
  badge: string | null;
};

export type SceneColumn = {
  column: TuningColumn;
  /** Canvas position of the column's left edge. */
  x: number;
  width: number;
  /** Top of the duration cell: 0 for pauses and whisper styles. */
  stripTop: number;
  /** Null for unvoiced moras, pauses and whisper styles. */
  pitch: ScenePitch | null;
  /** The mora text, hidden while its cells are shown or when it does not fit. */
  moraLabel: string | null;
  /** The consonant and vowel cells of the hovered duration strip. */
  cells: { consonant: SceneCell | null; vowel: SceneCell } | null;
};

export type TuningScene = {
  width: number;
  height: number;
  plotHeight: number;
  columns: SceneColumn[];
};

/** The visible part of the tuning timeline as positioned drawing items. */
export const buildScene = (input: {
  columns: readonly TuningColumn[];
  scrollLeft: number;
  width: number;
  height: number;
  durationHeight: number;
  mapping: PitchMapping;
  baselineFor: (column: TuningColumn) => number | null;
  hover: TuningHover;
}): TuningScene => {
  const { columns, scrollLeft, width, height, mapping, hover } = input;
  const whisper = isWhisper(mapping);
  const plotHeight = whisper ? 0 : Math.max(0, height - input.durationHeight);
  const { min, max, toPosition } = mapping.pitchScale;
  const hasSpan = max > min;
  const yOf = (position: number) => (1 - position) * plotHeight;
  const visible: SceneColumn[] = [];
  for (
    let index = firstColumnAfter(columns, scrollLeft);
    index < columns.length && columns[index].start < scrollLeft + width;
    index++
  ) {
    const column = columns[index];
    const { mora } = column;
    const x = column.start - scrollLeft;
    const fullHeight = whisper || column.isPause;
    const hoveredPart = hover?.index === column.index ? hover.part : null;

    let pitch: ScenePitch | null = null;
    if (!fullHeight && mora.pitch !== 0) {
      const baseline = input.baselineFor(column);
      const relative = driftBaseline(mapping, baseline) !== null;
      const y = yOf(pitchPosition(mora.pitch, baseline, mapping));
      const hovered = hoveredPart === "pitch";
      const center = plotHeight / 2;
      pitch = {
        y,
        hovered,
        fill: !hovered
          ? null
          : relative
            ? { top: Math.min(y, center), bottom: Math.max(y, center) }
            : { top: y, bottom: plotHeight },
        baselineY:
          resetTarget(baseline) === null
            ? null
            : relative
              ? center
              : hasSpan
                ? yOf(toPosition(baseline!))
                : null,
        ghost:
          relative && hasSpan
            ? {
                y: yOf(toPosition(mora.pitch)),
                outOfRange:
                  mora.pitch > max
                    ? "above"
                    : mora.pitch < min
                      ? "below"
                      : null,
              }
            : null,
        badge:
          hovered && column.width >= PITCH_BADGE_WIDTH
            ? pitchBadge(mora.pitch, baseline, mapping)
            : null,
      };
    }

    const stripHovered = hoveredPart !== null && hoveredPart !== "pitch";
    const cell = (
      cellX: number,
      cellWidth: number,
      label: string,
      part: TuningPart,
    ): SceneCell => ({
      x: cellX,
      width: cellWidth,
      label:
        label !== "" && cellWidth >= label.length * LATIN_CHAR_WIDTH
          ? label
          : null,
      hovered: hoveredPart === part,
    });
    visible.push({
      column,
      x,
      width: column.width,
      stripTop: fullHeight ? 0 : plotHeight,
      pitch,
      moraLabel:
        !stripHovered && !column.isPause && column.width >= MORA_TEXT_MIN_WIDTH
          ? mora.text
          : null,
      cells: stripHovered
        ? {
            consonant:
              column.consonantWidth === null
                ? null
                : cell(
                    x,
                    column.consonantWidth,
                    mora.consonant ?? "",
                    "consonant",
                  ),
            vowel: cell(
              x + (column.consonantWidth ?? 0),
              column.vowelWidth,
              column.isPause ? "" : mora.vowel,
              "vowel",
            ),
          }
        : null,
    });
  }
  return { width, height, plotHeight, columns: visible };
};

export type SceneColors = {
  text: string;
  border: string;
  faint: string;
  surface: string;
  accent: string;
  /** Background of a hovered pitch span or duration cell. */
  hover: string;
  /** Opacity of the hovered pitch span, lowered over the spectrogram. */
  fillAlpha: number;
  font: string;
  badgeFont: string;
};

/** Resolves the theme's colors and font as the canvas inherits them. */
export const readSceneColors = (
  canvas: HTMLCanvasElement,
  [red, green, blue]: [number, number, number],
  dimFill: boolean,
): SceneColors => {
  const style = getComputedStyle(canvas);
  const token = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;
  const dark = document.documentElement.classList.contains("dark");
  // `primary-50` on light themes and `primary-9` on dark ones.
  const mix = (channel: number) =>
    Math.round(dark ? channel * 0.4 : channel * 0.08 + 255 * 0.92);
  const family = style.fontFamily || "sans-serif";
  return {
    text: style.color || "#0f172a",
    border: token("--az-border", "#e2e8f0"),
    faint: token("--az-ink-faint", "#94a3b8"),
    surface: token("--az-surface", "#ffffff"),
    accent: `rgb(${red}, ${green}, ${blue})`,
    hover: `rgb(${mix(red)}, ${mix(green)}, ${mix(blue)})`,
    fillAlpha: dimFill ? 0.6 : 1,
    font: `${style.fontSize || "16px"} ${family}`,
    badgeFont: `11px ${family}`,
  };
};

const DASHED = [3, 3];
const DOTTED = [1, 2];

/** Paints a scene onto a context already scaled to CSS pixels. */
export const drawScene = (
  context: CanvasRenderingContext2D,
  scene: TuningScene,
  colors: SceneColors,
) => {
  const { height, plotHeight } = scene;
  const line = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    color: string,
    dash: number[] = [],
  ) => {
    context.strokeStyle = color;
    context.setLineDash(dash);
    context.beginPath();
    context.moveTo(x0, y0);
    context.lineTo(x1, y1);
    context.stroke();
  };
  /** A one-pixel horizontal line with its top edge at `y`, kept on the canvas. */
  const horizontal = (
    x: number,
    width: number,
    y: number,
    color: string,
    dash?: number[],
  ) => {
    const top = Math.min(Math.max(Math.round(y), 0), Math.max(height - 1, 0));
    line(x, top + 0.5, x + width, top + 0.5, color, dash);
  };

  context.clearRect(0, 0, scene.width, height);
  context.lineWidth = 1;
  context.textAlign = "center";
  context.textBaseline = "middle";

  for (const item of scene.columns) {
    const { x, width, stripTop, pitch, cells } = item;
    const stripHeight = height - stripTop;
    // Pause and whisper cells cover the spectrogram behind the pitch area.
    context.globalAlpha = 1;
    context.fillStyle = colors.surface;
    context.fillRect(x, stripTop, width, stripHeight);

    if (pitch !== null) {
      if (pitch.fill !== null) {
        context.globalAlpha = colors.fillAlpha;
        context.fillStyle = colors.hover;
        context.fillRect(
          x,
          pitch.fill.top,
          width,
          pitch.fill.bottom - pitch.fill.top,
        );
        context.globalAlpha = 1;
      }
      if (pitch.baselineY !== null) {
        horizontal(x, width, pitch.baselineY, colors.border, DASHED);
      }
      if (pitch.ghost !== null) {
        context.globalAlpha = 0.7;
        horizontal(x, width, pitch.ghost.y, colors.faint, DOTTED);
        context.globalAlpha = 1;
        if (pitch.ghost.outOfRange !== null) {
          const above = pitch.ghost.outOfRange === "above";
          const tip = above ? 3 : plotHeight - 3;
          const base = tip + (above ? ARROW_SIZE : -ARROW_SIZE);
          const center = x + width / 2;
          context.strokeStyle = colors.faint;
          context.setLineDash([]);
          context.beginPath();
          context.moveTo(center - ARROW_SIZE, base);
          context.lineTo(center, tip);
          context.lineTo(center + ARROW_SIZE, base);
          context.stroke();
        }
      }
      horizontal(
        x,
        width,
        pitch.y,
        pitch.hovered ? colors.accent : colors.faint,
      );
    }

    if (cells !== null) {
      for (const cell of [cells.consonant, cells.vowel]) {
        if (cell === null || !cell.hovered) continue;
        context.fillStyle = colors.hover;
        context.fillRect(cell.x, stripTop, cell.width, stripHeight);
      }
      if (cells.consonant !== null) {
        const edge = Math.round(cells.consonant.x + cells.consonant.width);
        line(edge - 0.5, stripTop, edge - 0.5, height, colors.border, DASHED);
      }
    }

    // The dashed borders: under the pitch area and at the column's right edge.
    if (stripTop > 0) {
      horizontal(x, width, stripTop - 1, colors.border, DASHED);
    }
    const right = Math.round(x + width);
    line(right - 0.5, 0, right - 0.5, height, colors.border, DASHED);

    context.setLineDash([]);
    context.fillStyle = colors.text;
    context.font = colors.font;
    const textY = stripTop + stripHeight / 2;
    if (item.moraLabel !== null) {
      context.fillText(item.moraLabel, x + width / 2, textY);
    }
    if (cells !== null) {
      for (const cell of [cells.consonant, cells.vowel]) {
        if (cell === null || cell.label === null) continue;
        context.fillText(cell.label, cell.x + cell.width / 2, textY);
      }
    }
  }

  // Badges go last so neighbouring columns never paint over them.
  for (const { x, width, pitch } of scene.columns) {
    if (pitch === null || pitch.badge === null) continue;
    const centerY = Math.min(
      Math.max(pitch.y, PITCH_BADGE_HEIGHT / 2),
      Math.max(plotHeight - PITCH_BADGE_HEIGHT / 2, PITCH_BADGE_HEIGHT / 2),
    );
    const left = x + width / 2 - PITCH_BADGE_WIDTH / 2;
    const top = centerY - PITCH_BADGE_HEIGHT / 2;
    context.fillStyle = colors.surface;
    if (typeof context.roundRect === "function") {
      context.beginPath();
      context.roundRect(left, top, PITCH_BADGE_WIDTH, PITCH_BADGE_HEIGHT, 6);
      context.fill();
    } else {
      context.fillRect(left, top, PITCH_BADGE_WIDTH, PITCH_BADGE_HEIGHT);
    }
    context.fillStyle = colors.text;
    context.font = colors.badgeFont;
    context.fillText(pitch.badge, x + width / 2, centerY);
  }
};
