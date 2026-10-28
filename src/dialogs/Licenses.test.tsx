import { commands, type DependencyLicense } from "$binding";
import { ConfigProvider } from "@contexts/config";
import { i18nProvider } from "@contexts/i18n";
import { MetaProvider } from "@contexts/meta";
import { UIProvider } from "@contexts/ui";
import { LicensesDialog } from "@dialogs/Licenses";
import { MultiProvider } from "@solid-primitives/context";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";

const report: DependencyLicense[] = [
  {
    id: "BSD-3-Clause",
    name: "WORLD license",
    text: "Copyright (c) 2010 M. Morise\nFull license text and disclaimer.",
    packages: [{ name: "WORLD", version: "vendored" }],
  },
];

function renderDialog(initialOpen = true) {
  const [open, setOpen] = createSignal(initialOpen);
  render(() => (
    <MultiProvider
      values={[
        [MetaProvider, []],
        [UIProvider, null],
        [ConfigProvider, null],
        [i18nProvider, null],
      ]}
    >
      <LicensesDialog open={open()} onOpenChange={setOpen} />
    </MultiProvider>
  ));
  return { open, setOpen };
}

describe("LicensesDialog", () => {
  it("searches names and grouped versions beside the heading and handles no matches", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const getLicenses = vi
      .spyOn(commands, "getDependencyLicenses")
      .mockResolvedValue([
        ...report,
        {
          id: "MIT",
          name: "MIT License",
          text: "Shared license text",
          packages: [
            { name: "alpha", version: "1.0" },
            { name: "alpha", version: "2.0" },
            { name: "beta", version: "1.0" },
          ],
        },
      ]);
    renderDialog();
    const search = await screen.findByRole("searchbox", {
      name: "Search libraries",
    });
    const header = screen.getByRole("heading", {
      name: "Libraries",
    }).parentElement!;
    expect(within(header).getByRole("searchbox")).toBe(search);

    await user.type(search, "  wOrLd ");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: "WORLD" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("region", { name: "WORLD vendored" }),
    ).toHaveTextContent("Full license text and disclaimer.");

    await user.clear(search);
    expect(screen.getAllByRole("option")).toHaveLength(3);
    await user.click(screen.getByRole("option", { name: "beta" }));
    await user.type(search, "2.0");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: "alpha" })).toHaveTextContent(
      "1.0, 2.0",
    );
    expect(
      screen.getByRole("region", { name: "alpha 1.0, 2.0" }),
    ).toBeVisible();

    await user.clear(search);
    expect(screen.getByRole("region", { name: "beta 1.0" })).toBeVisible();
    await user.type(search, "no-such-library");
    expect(screen.getByRole("status")).toHaveTextContent("No libraries found.");
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(search).toBeVisible();
    await user.clear(search);
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(screen.getByRole("region", { name: "beta 1.0" })).toBeVisible();
    expect(getLicenses).toHaveBeenCalledOnce();
  });

  it("only mounts a window of a large library list and finds off-screen matches", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    vi.spyOn(commands, "getDependencyLicenses").mockResolvedValue([
      {
        ...report[0],
        packages: Array.from({ length: 500 }, (_, index) => ({
          name: `library-${String(index).padStart(3, "0")}`,
          version: "1.0",
        })),
      },
    ]);
    renderDialog();
    await screen.findByRole("option", { name: "library-000" });
    expect(screen.getAllByRole("option").length).toBeLessThan(30);
    expect(
      screen.queryByRole("option", { name: "library-499" }),
    ).not.toBeInTheDocument();
    await user.type(screen.getByRole("searchbox"), "library-499");
    expect(
      await screen.findByRole("option", { name: "library-499" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("region", { name: "library-499 1.0" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(
      await screen.findByRole("option", { name: "library-000" }),
    ).toBeVisible();
    expect(screen.getAllByRole("option").length).toBeLessThan(30);
  });

  it("combines versions only when their complete license text sets match", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const shared: DependencyLicense = {
      id: "MIT",
      name: "MIT License",
      text: "Copyright A. Full license.",
      packages: [
        { name: "alpha", version: "10" },
        { name: "alpha", version: "2" },
        { name: "alpha", version: "1" },
        { name: "alpha", version: "4" },
        { name: "beta", version: "1" },
      ],
    };
    vi.spyOn(commands, "getDependencyLicenses").mockResolvedValue([
      {
        ...shared,
        text: "Shared notice",
        packages: [{ name: "alpha", version: "2" }],
      },
      shared,
      {
        ...shared,
        text: "Shared notice",
        packages: [
          { name: "alpha", version: "1" },
          { name: "alpha", version: "10" },
        ],
      },
      { ...shared, packages: [{ name: "alpha", version: "2" }] },
      {
        ...shared,
        text: "Copyright B. Full license.",
        packages: [{ name: "alpha", version: "3" }],
      },
      {
        ...shared,
        text: "Additional notice",
        packages: [{ name: "alpha", version: "4" }],
      },
      { ...shared, id: "ISC", packages: [{ name: "alpha", version: "5" }] },
    ]);
    renderDialog();
    await screen.findByRole("listbox", { name: "Libraries" });
    const options = screen.getAllByRole("option", { name: "alpha" });
    expect(options).toHaveLength(4);
    expect(options[0]).toHaveTextContent("1, 2, 10");
    expect(screen.getByRole("option", { name: "beta" })).toHaveTextContent("1");
    const combined = screen.getByRole("region", { name: "alpha 1, 2, 10" });
    expect(within(combined).getAllByText(shared.text)).toHaveLength(1);
    expect(within(combined).getByText("Shared notice")).toBeVisible();

    await user.click(options[1]);
    expect(screen.getByRole("region", { name: "alpha 3" })).toHaveTextContent(
      "Copyright B. Full license.",
    );
    await user.click(options[2]);
    const additional = screen.getByRole("region", { name: "alpha 4" });
    expect(additional).toHaveTextContent(shared.text);
    expect(additional).toHaveTextContent("Additional notice");
    await user.click(options[3]);
    expect(screen.getByRole("region", { name: "alpha 5" })).toHaveTextContent(
      "MIT License (ISC)",
    );
  });

  it("lists libraries alphabetically and switches all notices for each package and version", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const sharedLicense: DependencyLicense = {
      id: "MIT",
      name: "MIT License",
      text: "Shared license text",
      packages: [
        { name: "beta", version: "1" },
        { name: "alpha", version: "2" },
        { name: "alpha", version: "1" },
      ],
    };
    const notice: DependencyLicense = {
      id: "MIT",
      name: "MIT notice",
      text: "Additional alpha notice",
      packages: [{ name: "alpha", version: "1" }],
    };
    vi.spyOn(commands, "getDependencyLicenses").mockResolvedValue([
      ...report,
      sharedLicense,
      notice,
    ]);
    const { setOpen } = renderDialog();
    const list = await screen.findByRole("listbox", { name: "Libraries" });
    const options = within(list).getAllByRole("option");
    expect(options.map((item) => item.textContent)).toEqual([
      "alpha1",
      "alpha2",
      "beta1",
      "WORLDvendored",
    ]);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    const initial = screen.getByRole("region", { name: "alpha 1" });
    expect(within(initial).getByText("Shared license text")).toBeVisible();
    expect(within(initial).getByText("Additional alpha notice")).toBeVisible();
    initial.scrollTop = 200;

    await user.click(options[1]);
    const secondVersion = screen.getByRole("region", { name: "alpha 2" });
    expect(secondVersion.scrollTop).toBe(0);
    expect(
      within(secondVersion).queryByText("Additional alpha notice"),
    ).not.toBeInTheDocument();
    expect(
      within(secondVersion).getByText("Shared license text"),
    ).toBeVisible();
    expect(options[1]).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("option", { name: "WORLD" }));
    expect(screen.queryByText("Shared license text")).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "WORLD vendored" }),
    ).toHaveTextContent("Full license text and disclaimer.");
    setOpen(false);
    setOpen(true);
    expect(
      await screen.findByRole("region", { name: "WORLD vendored" }),
    ).toBeVisible();

    await user.click(screen.getByRole("option", { name: "beta" }));
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("option", { name: "WORLD" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("region", { name: "WORLD vendored" }),
    ).toBeVisible();
  });

  it("loads on first open, shows full notices, and retains the report across reopening", async () => {
    let resolve!: (value: DependencyLicense[]) => void;
    const getLicenses = vi
      .spyOn(commands, "getDependencyLicenses")
      .mockReturnValue(
        new Promise((done) => {
          resolve = done;
        }),
      );
    const { open, setOpen } = renderDialog(false);
    expect(getLicenses).not.toHaveBeenCalled();
    setOpen(true);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Loading licenses…",
    );
    resolve(report);
    expect(await screen.findByText("WORLD vendored")).toBeVisible();
    expect(
      screen.getByText(/Full license text and disclaimer/),
    ).toHaveTextContent("Copyright (c) 2010 M. Morise");
    fireEvent.click(
      screen.getByRole("button", { name: "Close licenses dialog" }),
    );
    await waitFor(() => expect(open()).toBe(false));
    setOpen(true);
    expect(await screen.findByText("WORLD vendored")).toBeVisible();
    expect(getLicenses).toHaveBeenCalledOnce();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(open()).toBe(false));
  });

  it("reports an IPC failure and retries successfully", async () => {
    const getLicenses = vi
      .spyOn(commands, "getDependencyLicenses")
      .mockRejectedValueOnce(new Error("IPC unavailable"))
      .mockResolvedValueOnce(report);
    renderDialog();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load dependency licenses.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("WORLD vendored")).toBeVisible();
    expect(getLicenses).toHaveBeenCalledTimes(2);
  });
});
