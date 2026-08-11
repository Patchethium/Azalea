import { type CharacterMeta, commands, type SpeakerIconResult } from "@binding";
import { SpeakerSelectionDialog } from "@dialogs/SpeakerSelection";
import { MultiProvider } from "@solid-primitives/context";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal, Show } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigProvider } from "../contexts/config";
import { i18nProvider } from "../contexts/i18n";
import { MetaProvider, useMetaStore } from "../contexts/meta";
import { UIProvider } from "../contexts/ui";

const speakers: CharacterMeta[] = [
  {
    name: "Engine Alias",
    speaker_uuid: "uuid-one",
    version: "1.0.0",
    order: 0,
    styles: [
      { id: 99, name: "Unordered", order: null, type: "talk" },
      { id: 8, name: "Later", order: 4, type: "talk" },
      { id: 7, name: "Representative", order: 1, type: "talk" },
      { id: 100, name: "Also Unordered", order: null, type: "talk" },
    ],
  },
  {
    name: "Missing Icon",
    speaker_uuid: "uuid-two",
    version: "1.0.0",
    order: 1,
    styles: [{ id: 9, name: "Normal", order: 0, type: "talk" }],
  },
];

const iconResult = (
  speakerUuid: string,
  dataUrl: string | null,
  error: string | null = null,
): SpeakerIconResult => ({
  speaker_uuid: speakerUuid,
  data_url: dataUrl,
  error,
});

const iconData = (value: string) => `data:image/png;base64,${btoa(value)}`;

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const renderDialog = (
  initialOpen = true,
  speakerList = speakers,
  onSelect = () => {},
) => {
  const [open, setOpen] = createSignal(initialOpen);
  let meta!: NonNullable<ReturnType<typeof useMetaStore>>;
  const Harness = () => {
    meta = useMetaStore()!;
    return (
      <SpeakerSelectionDialog
        open={open()}
        onOpenChange={setOpen}
        speakers={speakerList}
        selectedSpeakerUuid="uuid-one"
        onSelect={onSelect}
      />
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
  return { ...result, setOpen, getMeta: () => meta };
};

const renderRemountableDialog = () => {
  const [mounted, setMounted] = createSignal(true);
  const result = render(() => (
    <MultiProvider
      values={[
        [MetaProvider, []],
        [UIProvider, null],
        [ConfigProvider, null],
        [i18nProvider, null],
      ]}
    >
      <Show when={mounted()}>
        <SpeakerSelectionDialog
          open={true}
          onOpenChange={() => {}}
          speakers={speakers}
          selectedSpeakerUuid="uuid-one"
          onSelect={() => {}}
        />
      </Show>
    </MultiProvider>
  ));
  return { ...result, setMounted };
};

describe("SpeakerSelectionDialog persistent icons", () => {
  let objectUrlIndex = 0;

  beforeEach(() => {
    objectUrlIndex = 0;
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      objectUrlIndex += 1;
      return `blob:speaker-icon-${objectUrlIndex}`;
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(commands, "getCachedSpeakerIcons");
    vi.spyOn(commands, "downloadSpeakerIcons");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads cached icons by UUID and representative style and hides download", async () => {
    vi.mocked(commands.getCachedSpeakerIcons).mockResolvedValue({
      status: "ok",
      data: [
        iconResult("uuid-one", iconData("first")),
        iconResult("uuid-two", iconData("second")),
        iconResult("unknown", null, "bad cache entry"),
      ],
    });
    renderDialog();

    await waitFor(() =>
      expect(commands.getCachedSpeakerIcons).toHaveBeenCalledWith([
        { speaker_uuid: "uuid-one", style_id: 7 },
        { speaker_uuid: "uuid-two", style_id: 9 },
      ]),
    );
    expect(
      screen.getByRole("button", { name: "Engine Alias" }).querySelector("img"),
    ).toHaveAttribute("src", "blob:speaker-icon-1");
    expect(
      screen.getByRole("button", { name: "Missing Icon" }).querySelector("img"),
    ).toHaveAttribute("src", "blob:speaker-icon-2");
    expect(
      screen.queryByRole("button", { name: "Download speaker icons" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Engine Alias" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("downloads only missing icons and removes the button when complete", async () => {
    vi.mocked(commands.getCachedSpeakerIcons).mockResolvedValue({
      status: "ok",
      data: [
        iconResult("uuid-one", iconData("first")),
        iconResult("uuid-two", null),
      ],
    });
    vi.mocked(commands.downloadSpeakerIcons).mockResolvedValue({
      status: "ok",
      data: [iconResult("uuid-two", iconData("second"))],
    });
    renderDialog();

    const download = await screen.findByRole("button", {
      name: "Download speaker icons",
    });
    fireEvent.click(download);

    expect(commands.downloadSpeakerIcons).toHaveBeenCalledWith([
      { speaker_uuid: "uuid-two", style_id: 9 },
    ]);
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Download speaker icons" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "Missing Icon" }).querySelector("img"),
    ).toHaveAttribute("src", "blob:speaker-icon-2");
    document.body.append(download);
    fireEvent.click(download);
    download.remove();
  });

  it("ignores icon downloads invalidated by revision changes or cleanup", async () => {
    vi.mocked(commands.getCachedSpeakerIcons).mockResolvedValue({
      status: "ok",
      data: [
        iconResult("uuid-one", iconData("first")),
        iconResult("uuid-two", null),
      ],
    });
    const invalidated =
      deferred<Awaited<ReturnType<typeof commands.downloadSpeakerIcons>>>();
    const stale =
      deferred<Awaited<ReturnType<typeof commands.downloadSpeakerIcons>>>();
    vi.mocked(commands.downloadSpeakerIcons)
      .mockReturnValueOnce(invalidated.promise)
      .mockReturnValueOnce(stale.promise);
    const dialog = renderDialog();

    fireEvent.click(
      await screen.findByRole("button", { name: "Download speaker icons" }),
    );
    dialog.getMeta().clearSpeakerIcons();
    invalidated.resolve({
      status: "ok",
      data: [iconResult("uuid-two", iconData("invalidated"))],
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Download speaker icons" }),
      ).toBeEnabled(),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Download speaker icons" }),
    );
    await waitFor(() =>
      expect(commands.downloadSpeakerIcons).toHaveBeenCalledTimes(2),
    );
    dialog.unmount();
    stale.resolve({
      status: "ok",
      data: [
        iconResult("uuid-one", iconData("late one")),
        iconResult("uuid-two", iconData("late two")),
      ],
    });
    await Promise.resolve();
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
  });

  it("preserves successful icons after a partial failure and retries missing entries", async () => {
    vi.mocked(commands.getCachedSpeakerIcons).mockResolvedValue({
      status: "ok",
      data: [
        iconResult("uuid-one", iconData("first")),
        iconResult("uuid-two", null),
      ],
    });
    vi.mocked(commands.downloadSpeakerIcons)
      .mockResolvedValueOnce({
        status: "ok",
        data: [iconResult("uuid-two", null, "offline")],
      })
      .mockResolvedValueOnce({
        status: "ok",
        data: [iconResult("uuid-two", iconData("retry"))],
      });
    renderDialog();

    fireEvent.click(
      await screen.findByRole("button", { name: "Download speaker icons" }),
    );
    expect(
      await screen.findByText("Some speaker icons could not be downloaded."),
    ).toHaveAttribute("role", "alert");
    expect(
      screen.getByRole("button", { name: "Engine Alias" }).querySelector("img"),
    ).toHaveAttribute("src", "blob:speaker-icon-1");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Retry downloading speaker icons",
      }),
    );
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Missing Icon" })
          .querySelector("img"),
      ).toHaveAttribute("src", "blob:speaker-icon-2"),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reuses object URLs after the dialog is unmounted and remounted", async () => {
    vi.mocked(commands.getCachedSpeakerIcons).mockResolvedValue({
      status: "ok",
      data: [
        iconResult("uuid-one", iconData("first")),
        iconResult("uuid-two", iconData("second")),
      ],
    });
    const { setMounted, unmount } = renderRemountableDialog();

    await waitFor(() =>
      expect(document.querySelectorAll("img")).toHaveLength(2),
    );
    setMounted(false);
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Select Speaker" }),
      ).not.toBeInTheDocument(),
    );
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    setMounted(true);

    await waitFor(() =>
      expect(document.querySelectorAll("img")).toHaveLength(2),
    );
    expect(commands.getCachedSpeakerIcons).toHaveBeenCalledOnce();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole("button", { name: "Engine Alias" }).querySelector("img"),
    ).toHaveAttribute("src", "blob:speaker-icon-1");

    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:speaker-icon-1");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:speaker-icon-2");
  });

  it("preloads cached icons before the dialog opens", async () => {
    const cachedIcons =
      deferred<Awaited<ReturnType<typeof commands.getCachedSpeakerIcons>>>();
    vi.mocked(commands.getCachedSpeakerIcons).mockReturnValueOnce(
      cachedIcons.promise,
    );
    const { setOpen } = renderDialog(false);

    await waitFor(() =>
      expect(commands.getCachedSpeakerIcons).toHaveBeenCalledOnce(),
    );
    cachedIcons.resolve({
      status: "ok",
      data: [
        iconResult("uuid-one", iconData("first")),
        iconResult("uuid-two", iconData("second")),
      ],
    });
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(2));

    setOpen(true);
    expect(
      await screen.findByRole("button", { name: "Engine Alias" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Engine Alias" }).querySelector("img"),
    ).toHaveAttribute("src", "blob:speaker-icon-1");
    expect(commands.getCachedSpeakerIcons).toHaveBeenCalledOnce();
  });

  it("shows cache failures and ignores a response after cleanup", async () => {
    vi.mocked(commands.getCachedSpeakerIcons).mockResolvedValueOnce({
      status: "error",
      error: "cache failed",
    });
    const first = renderDialog();
    expect(
      await screen.findByText("Some speaker icons could not be downloaded."),
    ).toHaveAttribute("role", "alert");
    first.unmount();

    const cachedIcons =
      deferred<Awaited<ReturnType<typeof commands.getCachedSpeakerIcons>>>();
    vi.mocked(commands.getCachedSpeakerIcons).mockReturnValueOnce(
      cachedIcons.promise,
    );
    const second = renderDialog();
    await waitFor(() =>
      expect(commands.getCachedSpeakerIcons).toHaveBeenCalledTimes(2),
    );
    second.unmount();
    cachedIcons.resolve({
      status: "ok",
      data: [
        iconResult("uuid-one", iconData("late")),
        iconResult("uuid-two", null),
      ],
    });
    await Promise.resolve();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("handles broken images and download errors", async () => {
    vi.mocked(commands.getCachedSpeakerIcons).mockResolvedValue({
      status: "ok",
      data: [
        iconResult("uuid-one", iconData("first")),
        iconResult("uuid-two", null),
      ],
    });
    vi.mocked(commands.downloadSpeakerIcons)
      .mockResolvedValueOnce({ status: "error", error: "offline" })
      .mockRejectedValueOnce(new Error("network failed"));
    renderDialog();

    const image = await waitFor(() => {
      const value = screen
        .getByRole("button", { name: "Engine Alias" })
        .querySelector("img");
      expect(value).not.toBeNull();
      return value!;
    });
    fireEvent.error(image);
    expect(
      await screen.findByText("Some speaker icons could not be downloaded."),
    ).toHaveAttribute("role", "alert");

    const retry = screen.getByRole("button", {
      name: "Retry downloading speaker icons",
    });
    fireEvent.click(retry);
    await waitFor(() =>
      expect(commands.downloadSpeakerIcons).toHaveBeenCalledOnce(),
    );
    fireEvent.click(retry);
    await waitFor(() =>
      expect(commands.downloadSpeakerIcons).toHaveBeenCalledTimes(2),
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("renders but disables a speaker without styles", async () => {
    const noStyles: CharacterMeta = {
      name: "No Styles",
      speaker_uuid: "uuid-empty",
      version: "1.0.0",
      order: 2,
      styles: [],
    };
    vi.mocked(commands.getCachedSpeakerIcons).mockResolvedValue({
      status: "ok",
      data: [iconResult("uuid-one", null), iconResult("uuid-two", null)],
    });
    const onSelect = vi.fn();
    renderDialog(true, [...speakers, noStyles], onSelect);

    const button = await screen.findByRole("button", { name: "No Styles" });
    expect(button.querySelector("img")).not.toBeInTheDocument();
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onSelect).not.toHaveBeenCalled();
    expect(commands.getCachedSpeakerIcons).toHaveBeenCalledWith([
      { speaker_uuid: "uuid-one", style_id: 7 },
      { speaker_uuid: "uuid-two", style_id: 9 },
    ]);
  });
});
