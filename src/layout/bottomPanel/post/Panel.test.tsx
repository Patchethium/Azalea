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
  return 18 + (1 - Math.log(hz / low) / Math.log(high / low)) * (HEIGHT - 36);
};
const xOf = (frame: number) => frame * FRAME_WIDTH;

/** A readout cell of the post panel footer. */
const readout = (field: string) =>
  document.querySelector<HTMLElement>(`[data-post-readout-field="${field}"]`)!;

const lastSegment = <T,>(items: readonly T[]) => items[items.length - 1];

const firstBase = () =>
  postEditBase(getModifiedQuery(audioQuery(), preset()), 1);

const openPostTab = async (
  overrides: Parameters<typeof renderPanel>[0] = {},
  withWaveformSynthesis = false,
) => {
  const rendered = renderPanel(
    {
      bottom_scale: SCALE,
      playback_timeline: false,
      post_processing: true,
      ...overrides,
    },
    false,
    withWaveformSynthesis,
  );
  fireEvent.click(await screen.findByRole("tab", { name: "Post" }));
  return rendered;
};

const findCanvas = async () =>
  (await screen.findByRole("img", {
    name: /Frame-level pitch and timing editor/,
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
    expect(alert).toHaveTextContent("Couldn't analyze the pitch");
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

    // Hovering reports each value in its own fixed-width cell, with dashes
    // while the pointer is off the canvas.
    expect(readout("time")).toHaveTextContent("–");
    expect(readout("time").style.width).toBe("9ch");
    expect(readout("note").style.width).toBe("10ch");
    expect(readout("note").parentElement).toHaveClass("whitespace-nowrap");
    fireEvent.pointerMove(canvas, { clientX: xOf(30), clientY: yOf(300) });
    expect(readout("time")).toHaveTextContent("0.150 s");
    expect(readout("cursor")).toHaveTextContent(/^\d+\.\d Hz$/);
    expect(readout("note")).toHaveTextContent(/^D4 /);
    expect(readout("analyzed")).toHaveTextContent("200.0 Hz");
    expect(readout("edited")).toHaveTextContent("200.0 Hz");
    fireEvent.pointerLeave(canvas);
    expect(readout("edited")).toHaveTextContent("–");
    fireEvent.pointerMove(canvas, { clientX: xOf(5), clientY: yOf(300) });
    expect(readout("time")).toHaveTextContent("0.025 s");
    expect(readout("analyzed")).toHaveTextContent("unvoiced");

    drag(canvas, 0, [
      [xOf(30), yOf(300)],
      [xOf(35), yOf(300)],
      [xOf(40), yOf(300)],
    ]);
    const edit = getTextStore().textStore[0].post!;
    expect(edit.base).toBe(firstBase());
    expect(edit.f0).toHaveLength(1);
    expect(edit.f0[0].start).toBe(30);
    expect(edit.f0[0].f0).toHaveLength(11);
    for (const value of edit.f0[0].f0) expect(value).toBeCloseTo(300, 0);
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
    expect(getTextStore().textStore[0].post!.f0[0].start).toBe(36);

    fireEvent.click(reset);
    expect(getTextStore().textStore[0].post).toBeNull();
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
    const segments = getTextStore().textStore[0].post!.f0;
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
    const voiced = lastSegment(getTextStore().textStore[0].post!.f0);
    expect(voiced.start).toBe(85);
    expect(voiced.f0[0]).toBeCloseTo(200, 0);
  });

  it("adds, drags, and removes time anchors with the timing tool", async () => {
    vi.spyOn(commands, "analyzePostF0").mockResolvedValue({
      status: "ok",
      data: analysis(),
    });
    const play = vi
      .spyOn(commands, "playAudio")
      .mockResolvedValue({ status: "ok", data: null });
    const { getTextStore, getUiStore } = await openPostTab();
    const canvas = await findCanvas();
    // Draw a pitch edit first; time edits must carry it along.
    drag(canvas, 0, [
      [xOf(30), yOf(300)],
      [xOf(40), yOf(300)],
    ]);
    const pitch = getTextStore().textStore[0].post!.f0;

    const timing = screen.getByRole("button", { name: "Timing" });
    fireEvent.click(timing);
    expect(timing).toHaveAttribute("aria-pressed", "true");
    expect(getUiStore().uiStore.postTool).toBe("time");
    expect(canvas).toHaveClass("cursor-ew-resize");

    // A click adds an anchor without changing the timing.
    drag(canvas, 0, [[xOf(20), yOf(200)]]);
    expect(getTextStore().textStore[0].post!.time).toEqual([
      { source: 0.1, target: 0.1 },
    ]);
    // Clicking too close to it adds nothing; secondary clicks elsewhere do nothing.
    drag(canvas, 0, [[xOf(20) + 0.5, yOf(200)]]);
    drag(canvas, 2, [[xOf(60), yOf(200)]]);
    expect(getTextStore().textStore[0].post!.time).toHaveLength(1);

    // A second anchor dragged right stretches the span between them.
    drag(canvas, 0, [
      [xOf(60), yOf(200)],
      [xOf(70), yOf(200)],
      [xOf(80), yOf(200)],
    ]);
    const time = getTextStore().textStore[0].post!.time;
    expect(time).toHaveLength(2);
    expect(time[1].source).toBeCloseTo(0.3);
    expect(time[1].target).toBeCloseTo(0.4);
    expect(getTextStore().textStore[0].post!.f0).toEqual(pitch);

    // Hovering reports output time, and pitch strokes land on the source frames.
    fireEvent.pointerMove(canvas, { clientX: xOf(90), clientY: yOf(300) });
    expect(readout("time")).toHaveTextContent("0.450 s");

    fireEvent.click(screen.getByRole("button", { name: "Play selected cell" }));
    await waitFor(() => expect(play).toHaveBeenCalledOnce());
    expect(play.mock.calls[0][2]!.time).toEqual(time);

    // Dragging an existing anchor moves it; a secondary click removes it.
    drag(canvas, 0, [
      [xOf(80), yOf(200)],
      [xOf(70), yOf(200)],
    ]);
    expect(getTextStore().textStore[0].post!.time[1].target).toBeCloseTo(0.35);
    drag(canvas, 2, [[xOf(70), yOf(200)]]);
    expect(getTextStore().textStore[0].post!.time).toEqual([
      { source: 0.1, target: 0.1 },
    ]);

    // With the timing tool, a secondary drag off the anchors restores pitch.
    fireEvent.click(screen.getByRole("button", { name: "Pencil" }));
    expect(canvas).toHaveClass("cursor-crosshair");
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
    expect(getTextStore().textStore[0].post).not.toBeNull();

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
    await waitFor(() => expect(getTextStore().textStore[0].post).toBeNull());
  });

  it("undoes and redoes whole post edits until the content before them changes", async () => {
    vi.spyOn(commands, "analyzePostF0").mockResolvedValue({
      status: "ok",
      data: analysis(),
    });
    const { getTextStore } = await openPostTab();
    const canvas = await findCanvas();
    const undo = screen.getByRole("button", {
      name: "Undo post-processing edit",
    });
    const redo = screen.getByRole("button", {
      name: "Redo post-processing edit",
    });
    expect(undo).toBeDisabled();
    expect(redo).toBeDisabled();
    const post = () => getTextStore().textStore[0].post;
    const snapshot = () => JSON.parse(JSON.stringify(post()));

    drag(canvas, 0, [
      [xOf(30), yOf(300)],
      [xOf(40), yOf(300)],
    ]);
    const first = snapshot();
    fireEvent.click(screen.getByRole("button", { name: "Timing" }));
    drag(canvas, 0, [
      [xOf(60), yOf(200)],
      [xOf(70), yOf(200)],
    ]);
    const second = snapshot();
    expect(second!.time).toHaveLength(1);
    // A click on an anchor that leaves it in place records nothing.
    drag(canvas, 0, [[xOf(70), yOf(200)]]);

    fireEvent.click(undo);
    expect(snapshot()).toEqual(first);
    expect(redo).toBeEnabled();
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(post()).toBeNull();
    expect(undo).toBeDisabled();
    fireEvent.click(redo);
    expect(snapshot()).toEqual(first);
    fireEvent.keyDown(window, { key: "Z", ctrlKey: true, shiftKey: true });
    expect(snapshot()).toEqual(second);
    expect(redo).toBeDisabled();

    // Resetting is undoable, and a new edit clears the redo stack.
    fireEvent.click(
      screen.getByRole("button", { name: "Reset post-processing edits" }),
    );
    expect(post()).toBeNull();
    fireEvent.click(undo);
    expect(snapshot()).toEqual(second);
    fireEvent.click(undo);
    expect(redo).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Pencil" }));
    drag(canvas, 0, [
      [xOf(50), yOf(250)],
      [xOf(55), yOf(250)],
    ]);
    expect(redo).toBeDisabled();
    expect(undo).toBeEnabled();

    // Undo shortcuts typed in a text field are left to it.
    const field = document.createElement("input");
    document.body.append(field);
    const edited = snapshot();
    fireEvent.keyDown(field, { key: "z", ctrlKey: true });
    expect(snapshot()).toEqual(edited);
    field.remove();

    // Editing the content before the post tab clears both stacks.
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
    await waitFor(() => expect(post()).toBeNull());
    expect(undo).toBeDisabled();
    expect(redo).toBeDisabled();
  });

  it("sets the playback start freely on its own timeline", async () => {
    vi.spyOn(commands, "analyzePostF0").mockResolvedValue({
      status: "ok",
      data: analysis(),
    });
    const play = vi
      .spyOn(commands, "playAudio")
      .mockResolvedValue({ status: "ok", data: null });
    vi.spyOn(commands, "stopAudio").mockResolvedValue({
      status: "ok",
      data: null,
    });
    const { getTextStore, getUiStore } = await openPostTab({
      playback_timeline: true,
    });
    const canvas = await findCanvas();
    // The accent phrase timeline is replaced on the post tab.
    expect(
      screen.queryByRole("group", { name: "Playback starting phrase" }),
    ).not.toBeInTheDocument();
    const start = screen.getByRole("slider", { name: "Playback start" });
    expect(start).toHaveAttribute("aria-valuenow", "0");
    fireEvent.click(screen.getByRole("button", { name: "Play selected cell" }));
    await waitFor(() => expect(play).toHaveBeenCalledOnce());
    expect(play.mock.calls[0][3]).toBeNull();

    start.focus();
    fireEvent.keyDown(start, { key: "End" });
    fireEvent.keyDown(start, { key: "ArrowLeft" });
    expect(getUiStore().uiStore.postPlaybackStart).toMatchObject({
      blockId: getTextStore().textStore[0].id,
      base: firstBase(),
    });
    expect(getUiStore().uiStore.postPlaybackStart!.seconds).toBeCloseTo(0.499);

    // A time anchor before the start moves it with its sound.
    fireEvent.click(screen.getByRole("button", { name: "Timing" }));
    drag(canvas, 0, [
      [xOf(20), yOf(200)],
      [xOf(40), yOf(200)],
    ]);
    expect(Number(start.getAttribute("aria-valuenow"))).toBeCloseTo(0.599);
    expect(getUiStore().uiStore.postPlaybackStart!.seconds).toBeCloseTo(0.499);

    // Playing again while playing restarts from the start point.
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    // Playback takes the start on the synthesized waveform.
    expect(play.mock.calls[1][3]).toBeCloseTo(0.499);

    // A start set on another block is ignored.
    getUiStore().setUIStore("selectedTextBlockIndex", 1);
    await waitFor(() =>
      expect(
        screen.getByRole("slider", { name: "Playback start" }),
      ).toHaveAttribute("aria-valuenow", "0"),
    );
    getUiStore().setUIStore("selectedTextBlockIndex", 0);
    await findCanvas();

    // A right click on the timeline clears the start.
    fireEvent.contextMenu(document.querySelector("[data-post-timeline]")!);
    expect(getUiStore().uiStore.postPlaybackStart).toBeNull();
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

  it("hides the tab while disabled, ignoring edits until earlier tabs change", async () => {
    vi.spyOn(commands, "analyzePostF0").mockResolvedValue({
      status: "ok",
      data: analysis(),
    });
    const play = vi
      .spyOn(commands, "playAudio")
      .mockResolvedValue({ status: "ok", data: null });
    const { getConfigStore, getTextStore, getUiStore } = await openPostTab();
    const canvas = await findCanvas();
    drag(canvas, 0, [
      [xOf(30), yOf(300)],
      [xOf(40), yOf(300)],
    ]);
    const edit = JSON.parse(JSON.stringify(getTextStore().textStore[0].post));

    getConfigStore().setConfig("ui", "post_processing", false);
    await waitFor(() =>
      expect(screen.queryByRole("tab", { name: "Post" })).toBeNull(),
    );
    expect(getUiStore().uiStore.bottomPanel).toBe("tuning");
    // The edit is kept but not applied.
    expect(getTextStore().textStore[0].post).toEqual(edit);
    fireEvent.click(screen.getByRole("button", { name: "Play selected cell" }));
    await waitFor(() => expect(play).toHaveBeenCalledOnce());
    expect(play.mock.calls[0][2]).toBeNull();

    // Changing an earlier tab still clears it.
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
    await waitFor(() => expect(getTextStore().textStore[0].post).toBeNull());

    getConfigStore().setConfig("ui", "post_processing", true);
    expect(
      await screen.findByRole("tab", { name: "Post" }),
    ).toBeInTheDocument();
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
    expect(getTextStore().textStore[0].post).not.toBeNull();
    getConfigStore().setConfig("core", {
      ort_path: "/core",
      ojt_dir: "/dict",
      vvm_dir: "/models",
    });
    await expect(getConfigStore().reinitializeCore()).resolves.toBe(true);
    expect(getTextStore().textStore[0].post).toBeNull();
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
