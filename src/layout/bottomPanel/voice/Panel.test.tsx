import {
  type AccentPhrase,
  commands,
  events,
  type LoadedVoice,
  type VoiceSegment,
} from "$binding";
import { renderPanel } from "@layout/bottomPanel/testUtils";
import { SEMITONE } from "@layout/bottomPanel/tuning/voiceImport";
import { fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { audioQuery } from "../../../test/fixtures";
import { moveBoundary } from "./Panel";

const dialogs = vi.hoisted(() => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => dialogs);

const SCALE = 400;

const loaded = (voiceId = "voice-1"): LoadedVoice => ({
  voice_id: voiceId,
  analysis: {
    frame_period_ms: 5,
    f0: Array.from({ length: 101 }, (_, i) => (i > 20 && i < 80 ? 200 : 0)),
    f0_floor: 71,
    f0_ceil: 800,
    duration: 0.5,
    spectrogram: {
      rows: 2,
      min_hz: 40,
      max_hz: 1600,
      data: btoa("\0".repeat(202)),
    },
  },
});

/** The aligned fixture mora コ (k, o) between the edge pauses. */
const aligned = (): VoiceSegment[] => [
  { phoneme: "pau", start: 0, end: 0.1 },
  { phoneme: "k", start: 0.1, end: 0.15 },
  { phoneme: "o", start: 0.15, end: 0.4 },
  { phoneme: "pau", start: 0.4, end: 0.5 },
];

/** Mirrors the backend: lengths from the segments and the speaker's pitch. */
const timed = (
  phrases: AccentPhrase[],
  segments: VoiceSegment[],
  pitch = 5.3,
): AccentPhrase[] =>
  phrases.map((phrase) => ({
    ...phrase,
    moras: phrase.moras.map((m) => ({
      ...m,
      consonant_length: segments[1].end - segments[1].start,
      vowel_length: segments[2].end - segments[2].start,
      pitch,
    })),
  }));

// jsdom lacks PointerEvent, so testing-library would dispatch plain Events.
class PointerEventStub extends MouseEvent {
  readonly pointerId: number;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
  }
}

const openVoiceTab = async (overrides = {}) => {
  const view = renderPanel({
    voice_import: true,
    bottom_scale: SCALE,
    playback_timeline: false,
    ...overrides,
  });
  fireEvent.click(await screen.findByRole("tab", { name: "Voice" }));
  return view;
};

const firstMora = (view: ReturnType<typeof renderPanel>) =>
  view.getTextStore().textStore[0].query!.accent_phrases[0].moras[0];

const attachFile = async () => {
  dialogs.open.mockResolvedValue("/voice.wav");
  fireEvent.click(screen.getByRole("button", { name: "Choose voice file" }));
  return screen.findByRole("img", { name: "Voice alignment" });
};

describe("Voice panel", () => {
  beforeEach(() => {
    vi.stubGlobal("PointerEvent", PointerEventStub);
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null), {
      shouldMockEvents: true,
    });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(200);
    vi.spyOn(commands, "loadVoiceFile").mockResolvedValue({
      status: "ok",
      data: loaded(),
    });
    vi.spyOn(commands, "alignVoice").mockResolvedValue({
      status: "ok",
      data: aligned(),
    });
    vi.spyOn(commands, "voiceAccentPhrases").mockImplementation(
      async (_, phrases, segments) => ({
        status: "ok",
        data: timed(phrases, segments),
      }),
    );
    vi.spyOn(commands, "removeVoice").mockResolvedValue({
      status: "ok",
      data: null,
    });
    vi.spyOn(commands, "playVoice").mockResolvedValue({
      status: "ok",
      data: null,
    });
    vi.spyOn(commands, "startVoiceRecording").mockResolvedValue({
      status: "ok",
      data: null,
    });
    vi.spyOn(commands, "stopVoiceRecording").mockResolvedValue({
      status: "ok",
      data: loaded("voice-2"),
    });
    vi.spyOn(commands, "cancelVoiceRecording").mockResolvedValue({
      status: "ok",
      data: null,
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    dialogs.open.mockReset();
  });

  it("shows the voice tab between accent and tuning only while enabled", async () => {
    const view = renderPanel({ voice_import: false });
    await screen.findByRole("tab", { name: "Tuning" });
    expect(
      screen.queryByRole("tab", { name: "Voice" }),
    ).not.toBeInTheDocument();
    view.getConfigStore().setConfig("ui", "voice_import", true);
    const tabs = (await screen.findAllByRole("tab")).map(
      (tab) => tab.textContent,
    );
    expect(tabs.slice(0, 3)).toEqual(["Accent", "Voice", "Tuning"]);

    fireEvent.click(screen.getByRole("tab", { name: "Voice" }));
    expect(
      await screen.findByText(/Record yourself reading this text/),
    ).toBeVisible();
    view.getConfigStore().setConfig("ui", "voice_import", false);
    await waitFor(() =>
      expect(view.getUiStore().uiStore.bottomPanel).toBe("tuning"),
    );
  });

  it("aligns a chosen file and writes its timing and mapped pitch into the query", async () => {
    const view = await openVoiceTab();
    expect(screen.getByRole("button", { name: "Remove voice" })).toBeDisabled();
    await attachFile();
    expect(commands.loadVoiceFile).toHaveBeenCalledWith("/voice.wav");
    // The phrases as they were before the import wrote into them.
    expect(commands.alignVoice).toHaveBeenCalledWith(
      "voice-1",
      audioQuery().accent_phrases,
    );
    // One voiced mora lands on the style range's center, (4 + 6) / 2.
    await waitFor(() => expect(firstMora(view).pitch).toBeCloseTo(5));
    expect(firstMora(view).vowel_length).toBeCloseTo(0.25);
    expect(firstMora(view).consonant_length).toBeCloseTo(0.05);
    const block = view.getTextStore().textStore[0];
    expect(block.duration_is_modified).toBe(true);
    expect(block.pitch_is_modified).toBe(true);
    expect(block.accent_is_modified).toBe(false);

    const offset = screen.getByRole("spinbutton", {
      name: "Pitch offset (semitones)",
    });
    fireEvent.input(offset, { target: { value: "3" } });
    fireEvent.change(offset);
    await waitFor(() =>
      expect(firstMora(view).pitch).toBeCloseTo(5 + 3 * SEMITONE),
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove voice" }));
    expect(commands.removeVoice).toHaveBeenCalledWith("voice-1");
    expect(
      await screen.findByText(/Record yourself reading this text/),
    ).toBeVisible();
    // The result stays in the query.
    expect(firstMora(view).pitch).toBeCloseTo(5 + 3 * SEMITONE);
  });

  it("applies a dragged boundary when it is released", async () => {
    const view = await openVoiceTab();
    const canvas = await attachFile();
    await waitFor(() => expect(firstMora(view).vowel_length).toBeCloseTo(0.25));
    const apply = vi.mocked(commands.voiceAccentPhrases);
    apply.mockClear();

    // The k/o boundary at 0.15 s, dragged to 0.2 s.
    fireEvent.pointerMove(canvas, { clientX: 0.15 * SCALE, pointerId: 1 });
    expect(canvas).toHaveClass("cursor-ew-resize");
    fireEvent.pointerDown(canvas, {
      button: 0,
      clientX: 0.15 * SCALE,
      pointerId: 1,
    });
    fireEvent.pointerMove(canvas, { clientX: 0.2 * SCALE, pointerId: 1 });
    expect(apply).not.toHaveBeenCalled();
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(apply.mock.calls[0][2][1].end).toBeCloseTo(0.2);
    expect(apply.mock.calls[0][2][2].start).toBeCloseTo(0.2);
    await waitFor(() => expect(firstMora(view).vowel_length).toBeCloseTo(0.2));

    // Away from boundaries nothing is grabbed.
    apply.mockClear();
    fireEvent.pointerDown(canvas, {
      button: 0,
      clientX: 0.3 * SCALE,
      pointerId: 1,
    });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    expect(apply).not.toHaveBeenCalled();
  });

  it("realigns after accent edits and remaps after style changes", async () => {
    const view = await openVoiceTab();
    await attachFile();
    await waitFor(() => expect(firstMora(view).pitch).toBeCloseTo(5));
    vi.mocked(commands.alignVoice).mockClear();
    view
      .getTextStore()
      .setTextStore(0, "query", "accent_phrases", 0, "moras", 0, "vowel", "a");
    await waitFor(() => expect(commands.alignVoice).toHaveBeenCalledTimes(1));
    expect(
      vi.mocked(commands.alignVoice).mock.calls[0][1][0].moras[0].vowel,
    ).toBe("a");
    // Pitch edits leave the alignment alone.
    vi.mocked(commands.alignVoice).mockClear();
    view
      .getTextStore()
      .setTextStore(0, "query", "accent_phrases", 0, "moras", 0, "pitch", 5.9);
    await Promise.resolve();
    expect(commands.alignVoice).not.toHaveBeenCalled();
  });

  it("records or chooses a voice from the empty state's buttons", async () => {
    await openVoiceTab();
    dialogs.open.mockResolvedValue("/voice.wav");
    fireEvent.click(screen.getByRole("button", { name: "Choose file" }));
    await screen.findByRole("img", { name: "Voice alignment" });
    expect(commands.loadVoiceFile).toHaveBeenCalledWith("/voice.wav");

    fireEvent.click(screen.getByRole("button", { name: "Remove voice" }));
    fireEvent.click(await screen.findByRole("button", { name: "Record" }));
    await waitFor(() =>
      expect(commands.startVoiceRecording).toHaveBeenCalled(),
    );
    // Recording replaces the empty state and its buttons.
    await screen.findByRole("meter", { name: "Microphone level" });
    expect(screen.queryByRole("button", { name: "Record" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Choose file" })).toBeNull();
  });

  it("records a voice with a level meter and stops when the recording is full", async () => {
    const view = await openVoiceTab();
    fireEvent.click(screen.getByRole("button", { name: "Record voice" }));
    await waitFor(() =>
      expect(commands.startVoiceRecording).toHaveBeenCalled(),
    );
    const stop = await screen.findByRole("button", { name: "Stop recording" });
    await waitFor(() => expect(stop).toBeEnabled());
    await events.voiceRecordingLevelEvent.emit({
      peak: 0.4,
      seconds: 2.25,
      full: false,
    });
    const meter = await screen.findByRole("meter", {
      name: "Microphone level",
    });
    await waitFor(() => expect(meter).toHaveAttribute("aria-valuenow", "0.4"));
    expect(screen.getByText("Recording 2.3 s")).toBeVisible();

    await events.voiceRecordingLevelEvent.emit({
      peak: 0,
      seconds: 60,
      full: true,
    });
    await waitFor(() => expect(commands.stopVoiceRecording).toHaveBeenCalled());
    await screen.findByRole("img", { name: "Voice alignment" });
    expect(commands.alignVoice).toHaveBeenCalledWith(
      "voice-2",
      expect.any(Array),
    );
    await waitFor(() => expect(firstMora(view).pitch).toBeCloseTo(5));
  });

  it("reports recording, loading and alignment failures", async () => {
    vi.mocked(commands.startVoiceRecording).mockResolvedValueOnce({
      status: "error",
      error: "No microphone is available",
    });
    await openVoiceTab();
    fireEvent.click(screen.getByRole("button", { name: "Record voice" }));
    expect(await screen.findByText("No microphone is available")).toBeVisible();
    expect(screen.getByRole("button", { name: "Record voice" })).toBeEnabled();

    vi.mocked(commands.loadVoiceFile).mockResolvedValueOnce({
      status: "error",
      error: "Unsupported audio file",
    });
    dialogs.open.mockResolvedValue("/broken.txt");
    fireEvent.click(screen.getByRole("button", { name: "Choose voice file" }));
    expect(await screen.findByText("Unsupported audio file")).toBeVisible();

    vi.mocked(commands.alignVoice)
      .mockResolvedValueOnce({
        status: "error",
        error: "The recording is too short for this text",
      })
      .mockResolvedValue({ status: "ok", data: aligned() });
    dialogs.open.mockResolvedValue("/short.wav");
    fireEvent.click(screen.getByRole("button", { name: "Choose voice file" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The recording is too short for this text");
    fireEvent.click(screen.getByRole("button", { name: "Align again" }));
    await screen.findByRole("img", { name: "Voice alignment" });

    // A cancelled file dialog loads nothing.
    vi.mocked(commands.loadVoiceFile).mockClear();
    dialogs.open.mockResolvedValue(null);
    fireEvent.click(screen.getByRole("button", { name: "Choose voice file" }));
    await waitFor(() => expect(dialogs.open).toHaveBeenCalledTimes(3));
    expect(commands.loadVoiceFile).not.toHaveBeenCalled();
  });

  it("plays the voice from its timeline start on the voice tab", async () => {
    await openVoiceTab({ playback_timeline: true });
    const play = screen.getByRole("button", { name: "Play selected cell" });
    expect(play).toBeDisabled();
    await attachFile();
    await waitFor(() => expect(play).toBeEnabled());
    fireEvent.click(play);
    await waitFor(() =>
      expect(commands.playVoice).toHaveBeenCalledWith("voice-1", null),
    );
    const thumb = screen.getByRole("slider", { name: "Voice playback start" });
    thumb.focus();
    fireEvent.keyDown(thumb, { key: "End" });
    fireEvent.keyDown(thumb, { key: "ArrowLeft" });
    expect(Number(thumb.getAttribute("aria-valuenow"))).toBeCloseTo(0.499);
    await screen.findByRole("button", { name: "Stop playback" });
    vi.spyOn(commands, "stopAudio").mockResolvedValue({
      status: "ok",
      data: null,
    });
    fireEvent.click(screen.getByRole("button", { name: "Stop playback" }));
    await screen.findByRole("button", { name: "Play selected cell" });
    fireEvent.click(screen.getByRole("button", { name: "Play selected cell" }));
    await waitFor(() =>
      expect(vi.mocked(commands.playVoice).mock.lastCall?.[1]).toBeCloseTo(
        0.499,
      ),
    );
  });

  it("ignores a file that loads after its voice was replaced or the block removed", async () => {
    let finish!: (voice: LoadedVoice) => void;
    vi.mocked(commands.loadVoiceFile).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = (voice) => resolve({ status: "ok", data: voice });
        }),
    );
    const view = await openVoiceTab();
    dialogs.open.mockResolvedValue("/slow.wav");
    fireEvent.click(screen.getByRole("button", { name: "Choose voice file" }));
    await waitFor(() => expect(commands.loadVoiceFile).toHaveBeenCalled());
    await attachFile();
    finish(loaded("late"));
    await waitFor(() =>
      expect(commands.removeVoice).toHaveBeenCalledWith("late"),
    );
    expect(commands.alignVoice).not.toHaveBeenCalledWith(
      "late",
      expect.any(Array),
    );

    // Deleting the block forgets its voice.
    view.getTextStore().setTextStore((blocks) => blocks.slice(1));
    await waitFor(() =>
      expect(commands.removeVoice).toHaveBeenCalledWith("voice-1"),
    );
  });
});

describe("Voice panel mapping", () => {
  beforeEach(() => {
    vi.stubGlobal("PointerEvent", PointerEventStub);
    mockIPC((cmd) => (cmd === "get_os" ? "Linux" : null), {
      shouldMockEvents: true,
    });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(200);
    vi.spyOn(commands, "loadVoiceFile").mockResolvedValue({
      status: "ok",
      data: loaded(),
    });
    vi.spyOn(commands, "alignVoice").mockResolvedValue({
      status: "ok",
      data: aligned(),
    });
    vi.spyOn(commands, "removeVoice").mockResolvedValue({
      status: "ok",
      data: null,
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    dialogs.open.mockReset();
  });

  it("scales the contour, refits it and remaps when the style changes", async () => {
    // Two voiced moras a fifth of the style range's width apart.
    vi.spyOn(commands, "voiceAccentPhrases").mockImplementation(
      async (_, phrases, segments) => {
        const [first] = timed(phrases, segments);
        return {
          status: "ok",
          data: [
            {
              ...first,
              moras: [
                { ...first.moras[0], pitch: 5 },
                { ...first.moras[0], pitch: 5.4 },
              ],
            },
          ],
        };
      },
    );
    const view = await openVoiceTab();
    await attachFile();
    const pitches = () =>
      view
        .getTextStore()
        .textStore[0].query!.accent_phrases[0].moras.map((m) => m.pitch);
    // Fit: the style's width (2) over the speaker's (0.4), limited to 2x.
    await waitFor(() => expect(pitches()).toEqual([4.6, 5.4]));
    const scale = screen.getByRole("spinbutton", { name: "Intonation scale" });
    expect(scale).toHaveValue("2");
    const fit = screen.getByRole("button", { name: "Fit to the voice" });
    expect(fit).toBeDisabled();
    fireEvent.input(scale, { target: { value: "0.5" } });
    fireEvent.change(scale);
    await waitFor(() => {
      expect(pitches()[0]).toBeCloseTo(4.9);
      expect(pitches()[1]).toBeCloseTo(5.1);
    });
    fireEvent.click(fit);
    await waitFor(() => expect(pitches()).toEqual([4.6, 5.4]));

    // A style without a built-in range maps to the block's earlier pitches:
    // one mora at 5.4, whose zero width limits the scale to 0.25.
    view
      .getTextStore()
      .setProjectPresetStore(0, { style_id: 2, style_name: "Happy" });
    await waitFor(() => {
      expect(pitches()[0]).toBeCloseTo(5.35);
      expect(pitches()[1]).toBeCloseTo(5.45);
    });
  });

  it("shows failures to apply the voice below the alignment", async () => {
    vi.spyOn(commands, "voiceAccentPhrases").mockResolvedValue({
      status: "error",
      error: "The alignment does not match the text",
    });
    await openVoiceTab();
    await attachFile();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Voice import failed: The alignment does not match the text",
    );
    expect(screen.getByRole("img", { name: "Voice alignment" })).toBeVisible();
  });

  it("zooms with ctrl and the wheel, and clears the playback start with a right click", async () => {
    vi.spyOn(commands, "voiceAccentPhrases").mockImplementation(
      async (_, phrases, segments) => ({
        status: "ok",
        data: timed(phrases, segments),
      }),
    );
    const view = await openVoiceTab({ playback_timeline: true });
    await attachFile();
    const scroll = document.querySelector<HTMLElement>(
      '[data-bottom-panel-scroll="voice"]',
    )!;
    fireEvent.wheel(scroll, { deltaY: -1 });
    expect(view.getConfigStore().config.ui.bottom_scale).toBe(SCALE);
    fireEvent.wheel(scroll, { deltaY: -1, ctrlKey: true });
    expect(view.getConfigStore().config.ui.bottom_scale).toBe(SCALE + 50);
    fireEvent.wheel(scroll, { deltaY: 1, ctrlKey: true });
    expect(view.getConfigStore().config.ui.bottom_scale).toBe(SCALE);

    const thumb = screen.getByRole("slider", { name: "Voice playback start" });
    thumb.focus();
    fireEvent.keyDown(thumb, { key: "End" });
    expect(thumb).toHaveAttribute("aria-valuenow", "0.5");
    fireEvent.contextMenu(
      document.querySelector<HTMLElement>("[data-voice-timeline]")!,
    );
    await waitFor(() => expect(thumb).toHaveAttribute("aria-valuenow", "0"));
  });

  it("cancels a recording when the feature is switched off", async () => {
    vi.spyOn(commands, "startVoiceRecording").mockResolvedValue({
      status: "ok",
      data: null,
    });
    const cancel = vi
      .spyOn(commands, "cancelVoiceRecording")
      .mockResolvedValue({ status: "ok", data: null });
    vi.spyOn(commands, "stopVoiceRecording").mockResolvedValue({
      status: "error",
      error: "No recording is running",
    });
    const view = await openVoiceTab();
    fireEvent.click(screen.getByRole("button", { name: "Record voice" }));
    const stop = await screen.findByRole("button", { name: "Stop recording" });
    await waitFor(() => expect(stop).toBeEnabled());
    fireEvent.click(stop);
    expect(await screen.findByText("No recording is running")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Record voice" }));
    await screen.findByRole("button", { name: "Stop recording" });
    view.getConfigStore().setConfig("ui", "voice_import", false);
    await waitFor(() => expect(cancel).toHaveBeenCalled());
  });
});

describe("moveBoundary", () => {
  it("moves one boundary within its neighbours' minimum lengths", () => {
    const moved = moveBoundary(aligned(), 2, 0.2);
    expect(moved[1].end).toBe(0.2);
    expect(moved[2].start).toBe(0.2);
    expect(moveBoundary(aligned(), 2, 0)[2].start).toBeCloseTo(0.11);
    expect(moveBoundary(aligned(), 2, 1)[2].start).toBeCloseTo(0.39);
    expect(moveBoundary(aligned(), 0, 0.2)).toEqual(aligned());
    expect(moveBoundary(aligned(), 4, 0.2)).toEqual(aligned());
    const tight: VoiceSegment[] = [
      { phoneme: "a", start: 0, end: 0.01 },
      { phoneme: "b", start: 0.01, end: 0.015 },
    ];
    expect(moveBoundary(tight, 1, 0.012)).toEqual(tight);
  });
});
