import { commands, type PostF0Analysis } from "$binding";
import { renderPanel } from "@layout/bottomPanel/testUtils";
import { fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { mockIPC } from "@tauri-apps/api/mocks";
import { getModifiedQuery, postEditBase } from "$utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { audioQuery, metas, preset } from "../../../test/fixtures";
import { createPostAnalysisCache } from "@contexts/postAnalysis";

const FRAMES = 101;
const WIDTH = 800;
const HEIGHT = 218;
const SCALE = 360;
/** Pixels per 5 ms frame at the default scale. */
const FRAME_WIDTH = 0.005 * SCALE;

const analyzedF0 = Array.from({ length: FRAMES }, (_, frame) =>
  frame >= 20 && frame < 80 ? 200 : 0,
);

const analysis = (overrides: Partial<PostF0Analysis> = {}): PostF0Analysis => ({
  frame_period_ms: 5,
  f0: analyzedF0,
  f0_floor: 100,
  f0_ceil: 400,
  duration: 0.5,
  spectrogram: {
    rows: 4,
    min_hz: 40,
    max_hz: 1600,
    data: btoa(
      String.fromCharCode(
        ...Array.from({ length: FRAMES * 4 }, (_, i) => i % 256),
      ),
    ),
  },
  ...overrides,
});

/** The canvas y coordinate of `hz`, mirroring the panel's mapping. */
const yOf = (hz: number) => {
  const low = 100 / 2 ** (2 / 12);
  const high = 400 * 2 ** (2 / 12);
  return 18 + (1 - Math.log(hz / low) / Math.log(high / low)) * (HEIGHT - 18);
};
const xOf = (frame: number) => frame * FRAME_WIDTH;

const lastSegment = <T,>(items: readonly T[]) => items[items.length - 1];

const firstBase = () =>
  postEditBase(getModifiedQuery(audioQuery(), preset()), 1);

const openPostTab = async (
  overrides: Parameters<typeof renderPanel>[0] = {},
  withWaveformSynthesis = false,
) => {
  const rendered = renderPanel(
    { bottom_scale: SCALE, playback_timeline: false, ...overrides },
    false,
    withWaveformSynthesis,
  );
  fireEvent.click(await screen.findByRole("tab", { name: "Post" }));
  return rendered;
};

const findCanvas = async () =>
  (await screen.findByRole("img", {
    name: /Frame-level pitch editor/,
  })) as HTMLCanvasElement;

const drag = (
  canvas: HTMLCanvasElement,
  button: number,
  points: [number, number][],
) => {
  const [[x0, y0], ...rest] = points;
  fireEvent.pointerDown(canvas, {
    button,
    clientX: x0,
    clientY: y0,
    pointerId: 1,
  });
  for (const [x, y] of rest) {
    fireEvent.pointerMove(canvas, { clientX: x, clientY: y, pointerId: 1 });
  }
  fireEvent.pointerUp(canvas, { pointerId: 1 });
};

// jsdom lacks PointerEvent, so testing-library would dispatch plain Events.
class PointerEventStub extends MouseEvent {
  readonly pointerId: number;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
  }
}

describe("Post panel", () => {
  beforeEach(() => {
    vi.stubGlobal("PointerEvent", PointerEventStub);
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null), {
      shouldMockEvents: true,
    });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(
      WIDTH,
    );
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(
      HEIGHT,
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("analyzes the selected block and caches the result across remounts", async () => {
    const analyze = vi
      .spyOn(commands, "analyzePostF0")
      .mockResolvedValue({ status: "ok", data: analysis() });
    await openPostTab();

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Analyzing pitch…",
    );
    await findCanvas();
    expect(analyze).toHaveBeenCalledOnce();
    expect(analyze.mock.calls[0][0]).toMatchObject({
      prePhonemeLength: 0.1,
      postPhonemeLength: 0.2,
    });
    expect(analyze.mock.calls[0][1]).toBe(1);
    expect(screen.getByText(/Drag to draw the pitch/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Tuning" }));
    fireEvent.click(screen.getByRole("tab", { name: "Post" }));
    await findCanvas();
    expect(analyze).toHaveBeenCalledOnce();
  });

  it("shows analysis failures and retries", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const analyze = vi
      .spyOn(commands, "analyzePostF0")
      .mockResolvedValueOnce({ status: "error", error: "too short" })
      .mockRejectedValueOnce(new Error("ipc down"))
      .mockResolvedValue({ status: "ok", data: analysis() });
    await openPostTab();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Pitch analysis failed");
    expect(alert).toHaveTextContent("too short");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("ipc down"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await findCanvas();
    expect(analyze).toHaveBeenCalledTimes(3);
  });

  it("ignores an analysis that resolves after the block changed", async () => {
    let resolveFirst!: (value: { status: "ok"; data: PostF0Analysis }) => void;
    const analyze = vi
      .spyOn(commands, "analyzePostF0")
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveFirst = resolve)),
      )
      .mockResolvedValue({
        status: "ok",
        data: analysis({ f0: analyzedF0.map((value) => value * 2) }),
      });
    const { getUiStore } = await openPostTab();
    await waitFor(() => expect(analyze).toHaveBeenCalledOnce());
    getUiStore().setUIStore("selectedTextBlockIndex", 1);
    await waitFor(() => expect(analyze).toHaveBeenCalledTimes(2));
    resolveFirst({ status: "ok", data: analysis() });
    await findCanvas();
    expect(analyze.mock.calls[1][0].speedScale).toBe(1);
  });

  it("draws, restores, and resets frame-level pitch edits", async () => {
    vi.spyOn(commands, "analyzePostF0").mockResolvedValue({
      status: "ok",
      data: analysis(),
    });
    const play = vi
      .spyOn(commands, "playAudio")
      .mockResolvedValue({ status: "ok", data: null });
    const { getTextStore } = await openPostTab();
    const canvas = await findCanvas();
    const reset = screen.getByRole("button", {
      name: "Reset post-processing edits",
    });
    expect(reset).toBeDisabled();

    // Hovering reports the cursor, analyzed and edited values.
    fireEvent.pointerMove(canvas, { clientX: xOf(30), clientY: yOf(300) });
    expect(screen.getByText(/^0\.150 s/)).toHaveTextContent(
      "analyzed 200.0 Hz · edited 200.0 Hz",
    );
    fireEvent.pointerLeave(canvas);
    fireEvent.pointerMove(canvas, { clientX: xOf(5), clientY: yOf(300) });
    expect(screen.getByText(/^0\.025 s/)).toHaveTextContent(
      "analyzed unvoiced",
    );

    drag(canvas, 0, [
      [xOf(30), yOf(300)],
      [xOf(35), yOf(300)],
      [xOf(40), yOf(300)],
    ]);
    const edit = getTextStore().textStore[0].post_f0!;
    expect(edit.base).toBe(firstBase());
    expect(edit.segments).toHaveLength(1);
    expect(edit.segments[0].start).toBe(30);
    expect(edit.segments[0].f0).toHaveLength(11);
    for (const value of edit.segments[0].f0) expect(value).toBeCloseTo(300, 0);
    expect(reset).toBeEnabled();

    // Playback sends the edit with the query it was made on.
    fireEvent.click(screen.getByRole("button", { name: "Play selected cell" }));
    await waitFor(() => expect(play).toHaveBeenCalledOnce());
    expect(play.mock.calls[0][2]).toEqual(edit);

    // Right-dragging restores frames near the pointer.
    fireEvent.contextMenu(canvas);
    drag(canvas, 2, [
      [xOf(30), yOf(150)],
      [xOf(33), yOf(150)],
    ]);
    expect(getTextStore().textStore[0].post_f0!.segments[0].start).toBe(36);

    fireEvent.click(reset);
    expect(getTextStore().textStore[0].post_f0).toBeNull();
    expect(reset).toBeDisabled();
  });

  it("draws straight lines and only voices unvoiced frames on request", async () => {
    vi.spyOn(commands, "analyzePostF0").mockResolvedValue({
      status: "ok",
      data: analysis(),
    });
    const { getTextStore, getUiStore } = await openPostTab();
    const canvas = await findCanvas();

    const line = screen.getByRole("button", { name: "Line" });
    fireEvent.click(line);
    expect(line).toHaveAttribute("aria-pressed", "true");
    expect(getUiStore().uiStore.postTool).toBe("line");
    drag(canvas, 0, [
      [xOf(10), yOf(200)],
      [xOf(60), yOf(250)],
      [xOf(30), yOf(400)],
    ]);
    // The line ends where the pointer was released, through unvoiced frames.
    const segments = getTextStore().textStore[0].post_f0!.segments;
    expect(segments[0].start).toBe(20);
    expect(
      lastSegment(segments).start + lastSegment(segments).f0.length - 1,
    ).toBe(30);

    const voicing = screen.getByRole("button", {
      name: "Draw on unvoiced frames",
    });
    fireEvent.click(voicing);
    expect(voicing).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Pencil" }));
    drag(canvas, 0, [
      [xOf(85), yOf(200)],
      [xOf(90), yOf(200)],
    ]);
    const voiced = lastSegment(getTextStore().textStore[0].post_f0!.segments);
    expect(voiced.start).toBe(85);
    expect(voiced.f0[0]).toBeCloseTo(200, 0);
  });

  it("clears post edits once the content before them changes", async () => {
    vi.spyOn(commands, "analyzePostF0").mockResolvedValue({
      status: "ok",
      data: analysis(),
    });
    const { getTextStore } = await openPostTab();
    const canvas = await findCanvas();
    drag(canvas, 0, [
      [xOf(30), yOf(300)],
      [xOf(40), yOf(300)],
    ]);
    expect(getTextStore().textStore[0].post_f0).not.toBeNull();

    getTextStore().setTextStore(
      0,
      "query",
      "accent_phrases",
      0,
      "moras",
      0,
      "pitch",
      5.6,
    );
    await waitFor(() => expect(getTextStore().textStore[0].post_f0).toBeNull());
  });

  it("zooms with Ctrl+wheel and ignores strokes without an analysis", async () => {
    vi.spyOn(commands, "analyzePostF0").mockResolvedValue({
      status: "ok",
      data: analysis(),
    });
    const { getConfigStore } = await openPostTab();
    const canvas = await findCanvas();
    const scroll = canvas.closest("[data-bottom-panel-scroll]")!;
    fireEvent.wheel(scroll, { deltaY: -1 });
    expect(getConfigStore().config.ui.bottom_scale).toBe(SCALE);
    fireEvent.wheel(scroll, { deltaY: -1, ctrlKey: true });
    expect(getConfigStore().config.ui.bottom_scale).toBe(SCALE + 50);
    fireEvent.wheel(scroll, { deltaY: 1, ctrlKey: true });
    expect(getConfigStore().config.ui.bottom_scale).toBe(SCALE);
    fireEvent.scroll(scroll, { target: { scrollLeft: 10 } });

    // Middle-button presses do nothing.
    fireEvent.pointerDown(canvas, { button: 1, clientX: 50, clientY: 50 });
    fireEvent.pointerUp(canvas);
  });

  it("buffers the post-processed waveform with the edit", async () => {
    vi.spyOn(commands, "analyzePostF0").mockResolvedValue({
      status: "ok",
      data: analysis(),
    });
    const synthesize = vi
      .spyOn(commands, "synthesize")
      .mockResolvedValue({ status: "ok", data: null });
    vi.spyOn(commands, "cancelSynthesis").mockResolvedValue({
      status: "ok",
      data: null,
    });
    await openPostTab(
      {
        buffer_render: true,
        nonblocking_synthesis: false,
        synthesis_delay_ms: 0,
      },
      true,
    );
    const canvas = await findCanvas();
    await waitFor(() => expect(synthesize).toHaveBeenCalled(), {
      timeout: 3000,
    });
    expect(synthesize.mock.calls[0][0].post).toBeNull();
    drag(canvas, 0, [
      [xOf(30), yOf(300)],
      [xOf(40), yOf(300)],
    ]);
    await waitFor(
      () => expect(synthesize.mock.lastCall![0].post).not.toBeNull(),
      { timeout: 3000 },
    );
    const [first, last] = [
      synthesize.mock.calls[0][0],
      synthesize.mock.lastCall![0],
    ];
    expect(last.post!.base).toBe(firstBase());
    expect(last.hash).not.toBe(first.hash);
  });

  it("drops post edits when the voice setup changes", async () => {
    vi.spyOn(commands, "analyzePostF0").mockResolvedValue({
      status: "ok",
      data: analysis(),
    });
    vi.spyOn(commands, "initCore").mockResolvedValue({
      status: "ok",
      data: null,
    });
    vi.spyOn(commands, "reinitCore").mockResolvedValue({
      status: "ok",
      data: null,
    });
    vi.spyOn(commands, "getMetas").mockResolvedValue({
      status: "ok",
      data: metas,
    });
    vi.spyOn(commands, "getRange").mockResolvedValue({
      status: "ok",
      data: {},
    });
    vi.spyOn(commands, "audioQuery").mockResolvedValue({
      status: "ok",
      data: audioQuery(),
    });
    const { getConfigStore, getTextStore } = await openPostTab();
    const canvas = await findCanvas();
    drag(canvas, 0, [
      [xOf(30), yOf(300)],
      [xOf(40), yOf(300)],
    ]);
    getTextStore().setTextStore(0, "pitch_is_modified", true);
    expect(getTextStore().textStore[0].post_f0).not.toBeNull();
    getConfigStore().setConfig("core", {
      ort_path: "/core",
      ojt_dir: "/dict",
      vvm_dir: "/models",
    });
    await expect(getConfigStore().reinitializeCore()).resolves.toBe(true);
    expect(getTextStore().textStore[0].post_f0).toBeNull();
  });
});

describe("post analysis cache", () => {
  it("keeps the most recent analyses and can be cleared", () => {
    const cache = createPostAnalysisCache();
    const prepared = {
      ...analysis(),
      spectrogram: {
        rows: 0,
        minHz: 40,
        maxHz: 1600,
        values: new Uint8Array(),
      },
    };
    for (let index = 0; index < 17; index++) {
      cache.setPostAnalysis(`key-${index}`, prepared);
    }
    expect(cache.getPostAnalysis("key-0")).toBeNull();
    expect(cache.getPostAnalysis("key-16")).toBe(prepared);
    cache.clearPostAnalyses();
    expect(cache.getPostAnalysis("key-16")).toBeNull();
  });
});
