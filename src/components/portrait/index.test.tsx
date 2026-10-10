import { commands } from "$binding";
import { SpeakerPortraitPanel } from "@components/portrait";
import { MultiProvider } from "@solid-primitives/context";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal, Show } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigProvider } from "@contexts/config";
import { i18nProvider } from "@contexts/i18n";
import { MetaProvider, useMetaStore } from "@contexts/meta";
import { UIProvider } from "@contexts/ui";

type PortraitResult = Awaited<ReturnType<typeof commands.getSpeakerPortrait>>;
type DownloadResult = Awaited<
  ReturnType<typeof commands.downloadSpeakerPortraits>
>;

const portraitData = (value: string) => `data:image/png;base64,${btoa(value)}`;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

const renderPanel = () => {
  const [styleId, setStyleId] = createSignal(1);
  const [mounted, setMounted] = createSignal(true);
  let meta!: NonNullable<ReturnType<typeof useMetaStore>>;
  const Harness = () => {
    meta = useMetaStore()!;
    return (
      <Show when={mounted()}>
        <SpeakerPortraitPanel
          speakerUuid="speaker"
          styleId={styleId()}
          speakerUuids={["speaker", "other"]}
          alt="Portrait of Speaker"
        />
      </Show>
    );
  };
  const result = render(() => (
    <MultiProvider
      values={[
        [MetaProvider, []],
        [UIProvider, null],
        [ConfigProvider, null],
        [i18nProvider, null],
      ]}
    >
      <Harness />
    </MultiProvider>
  ));
  return { ...result, setStyleId, setMounted, meta: () => meta };
};

const downloadButton = () =>
  screen.findByRole("button", { name: "Download portraits" });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SpeakerPortraitPanel", () => {
  it("loads the style portrait and reloads it when portraits change", async () => {
    const portrait = vi
      .spyOn(commands, "getSpeakerPortrait")
      .mockResolvedValueOnce({ status: "ok", data: portraitData("1") })
      .mockResolvedValueOnce({ status: "ok", data: portraitData("2") })
      .mockResolvedValueOnce({ status: "ok", data: portraitData("3") });
    const view = renderPanel();

    const image = await screen.findByRole("img", {
      name: "Portrait of Speaker",
    });
    expect(image).toHaveAttribute("src", portraitData("1"));
    expect(portrait).toHaveBeenCalledWith({
      speaker_uuid: "speaker",
      style_id: 1,
    });
    expect(
      screen.queryByRole("button", { name: "Download portraits" }),
    ).not.toBeInTheDocument();

    view.setStyleId(2);
    await waitFor(() =>
      expect(image).toHaveAttribute("src", portraitData("2")),
    );
    view.meta().invalidateSpeakerPortraits();
    await waitFor(() =>
      expect(image).toHaveAttribute("src", portraitData("3")),
    );
  });

  it("downloads every speaker's portraits from the empty panel", async () => {
    vi.spyOn(commands, "getSpeakerPortrait")
      .mockResolvedValueOnce({ status: "ok", data: null })
      .mockResolvedValueOnce({ status: "ok", data: portraitData("new") });
    const job = deferred<DownloadResult>();
    const download = vi
      .spyOn(commands, "downloadSpeakerPortraits")
      .mockReturnValue(job.promise);
    renderPanel();

    fireEvent.click(await downloadButton());
    expect(download).toHaveBeenCalledWith(["speaker", "other"]);
    const busy = screen.getByRole("button", { name: "Downloading portraits…" });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");

    job.resolve({
      status: "ok",
      data: [
        { speaker_uuid: "speaker", cached: true, error: null },
        { speaker_uuid: "other", cached: true, error: null },
      ],
    });
    expect(
      await screen.findByRole("img", { name: "Portrait of Speaker" }),
    ).toHaveAttribute("src", portraitData("new"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reports failed downloads and allows a retry", async () => {
    vi.spyOn(commands, "getSpeakerPortrait").mockResolvedValue({
      status: "ok",
      data: null,
    });
    vi.spyOn(commands, "downloadSpeakerPortraits")
      .mockResolvedValueOnce({ status: "error", error: "locked" })
      .mockRejectedValueOnce(new Error("IPC failed"))
      .mockResolvedValueOnce({
        status: "ok",
        data: [
          { speaker_uuid: "speaker", cached: false, error: "offline" },
          { speaker_uuid: "other", cached: false, error: "offline" },
        ],
      });
    renderPanel();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      fireEvent.click(await downloadButton());
      expect(
        await screen.findByText("Some portraits could not be downloaded."),
      ).toBeInTheDocument();
    }
    expect(commands.downloadSpeakerPortraits).toHaveBeenCalledTimes(3);
  });

  it("renders no portrait or button when loading fails, and logs the error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(commands, "getSpeakerPortrait")
      .mockResolvedValueOnce({ status: "error", error: "corrupt" })
      .mockRejectedValueOnce(new Error("IPC failed"));
    const view = renderPanel();
    await waitFor(() => expect(console.error).toHaveBeenCalledTimes(1));
    view.setStyleId(2);
    await waitFor(() => expect(console.error).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    // A failed read shows the download button so portraits can be restored.
    expect(await downloadButton()).toBeEnabled();
  });

  it("ignores a slower response for a previous style", async () => {
    const first = deferred<PortraitResult>();
    vi.spyOn(commands, "getSpeakerPortrait")
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ status: "ok", data: portraitData("2") });
    const view = renderPanel();
    view.setStyleId(2);

    const image = await screen.findByRole("img", {
      name: "Portrait of Speaker",
    });
    first.resolve({ status: "ok", data: portraitData("1") });
    await Promise.resolve();
    expect(image).toHaveAttribute("src", portraitData("2"));
  });

  it("reloads portraits after a download that finishes once unmounted", async () => {
    vi.spyOn(commands, "getSpeakerPortrait").mockResolvedValue({
      status: "ok",
      data: null,
    });
    const job = deferred<DownloadResult>();
    vi.spyOn(commands, "downloadSpeakerPortraits").mockReturnValue(job.promise);
    const view = renderPanel();
    fireEvent.click(await downloadButton());
    const revision = view.meta().speakerPortraitRevision();
    view.setMounted(false);
    job.resolve({ status: "ok", data: [] });
    await waitFor(() =>
      expect(view.meta().speakerPortraitRevision()).toBe(revision + 1),
    );
  });
});
