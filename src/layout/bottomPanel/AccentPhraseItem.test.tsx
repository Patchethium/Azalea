import { AccentPhraseItem } from "@layout/bottomPanel/AccentPhraseItem";
import { render, screen } from "@solidjs/testing-library";
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
});
