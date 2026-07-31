import { MultiProvider } from "@solid-primitives/context";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal, Show } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CharacterMeta,
  commands,
  type SpeakerIconResult,
} from "../binding";
import { ConfigProvider } from "../contexts/config";
import { i18nProvider } from "../contexts/i18n";
import { MetaProvider } from "../contexts/meta";
import { UIProvider } from "../contexts/ui";
import { SpeakerSelectionDialog } from "./SpeakerSelectionDialog";

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

const renderDialog = () => {
  const [open, setOpen] = createSignal(true);
  const result = render(() => (
    <MultiProvider
      values={[
        [MetaProvider, []],
        [UIProvider, null],
        [ConfigProvider, null],
        [i18nProvider, null],
      ]}
    >
      <SpeakerSelectionDialog
        open={open()}
        onOpenChange={setOpen}
        speakers={speakers}
        selectedSpeakerUuid="uuid-one"
        onSelect={() => {}}
      />
    </MultiProvider>
  ));
  return { ...result, setOpen };
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

  it("does not let a stale cache read replace a newer open", async () => {
    const staleRead =
      deferred<Awaited<ReturnType<typeof commands.getCachedSpeakerIcons>>>();
    vi.mocked(commands.getCachedSpeakerIcons)
      .mockReturnValueOnce(staleRead.promise)
      .mockResolvedValueOnce({
        status: "ok",
        data: [iconResult("uuid-one", null), iconResult("uuid-two", null)],
      });
    const { setOpen } = renderDialog();

    await waitFor(() =>
      expect(commands.getCachedSpeakerIcons).toHaveBeenCalledOnce(),
    );
    setOpen(false);
    await waitFor(() =>
      expect(
        screen.getByRole("dialog", { name: "Select Speaker" }),
      ).toHaveAttribute("data-closed"),
    );
    setOpen(true);
    expect(
      await screen.findByRole("button", { name: "Download speaker icons" }),
    ).toBeEnabled();

    staleRead.resolve({
      status: "ok",
      data: [
        iconResult("uuid-one", iconData("stale-first")),
        iconResult("uuid-two", iconData("stale-second")),
      ],
    });
    await Promise.resolve();
    expect(document.querySelectorAll("img")).toHaveLength(0);
  });
});
