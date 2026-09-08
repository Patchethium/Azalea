import { AccentPhraseItem } from "@layout/bottomPanel/AccentPhraseItem";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { audioQuery } from "../../test/fixtures";

describe("AccentPhraseItem", () => {
  it("hides the accent slider for a single-mora phrase", () => {
    const sourcePhrase = audioQuery().accent_phrases[0];
    const phrase = {
      ...sourcePhrase,
      accent: 1,
      moras: [sourcePhrase.moras[0]],
      pause_mora: null,
    };

    render(() => (
      <AccentPhraseItem
        mode="accent"
        label="Accent position"
        phrase={phrase}
        setPhrase={vi.fn()}
      />
    ));

    const mora = screen.getByText(phrase.moras[0].text);
    expect(mora).not.toHaveClass("mt-10");
    expect(mora).not.toHaveClass("mb-10");
    expect(
      screen.queryByRole("slider", { name: "Accent position" }),
    ).not.toBeInTheDocument();
  });

  it("closes the phoneme editor on Escape", async () => {
    const sourcePhrase = audioQuery().accent_phrases[0];

    render(() => (
      <AccentPhraseItem
        mode="full"
        phrase={sourcePhrase}
        setPhrase={vi.fn()}
        refreshMoraData={vi.fn()}
        onSplit={vi.fn()}
        onCombine={vi.fn()}
        onEdit={vi.fn()}
      />
    ));

    fireEvent.click(screen.getByText(sourcePhrase.moras[0].text));
    const input = await screen.findByRole("textbox");
    await waitFor(() => expect(input).toHaveFocus());

    fireEvent.keyDown(input, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument(),
    );
  });
});
