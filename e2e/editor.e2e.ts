describe("Azalea packaged smoke test", () => {
  it("selects the test core, queries text, buffers it, and controls playback", async () => {
    const welcome = await $(
      "div=Welcome to Azalea, an unofficial GUI for VOICEVOX",
    );
    await welcome.waitForDisplayed();

    const pluginAvailable = await browser.tauri.execute(
      () => "wdioTauri" in window,
    );
    expect(pluginAvailable).toBe(true);

    const pickButton = await $("button=Pick it");
    await pickButton.click();

    const editor = await $('[aria-label="Text to synthesize"]');
    await editor.waitForDisplayed();
    expect(await editor.getAttribute("contenteditable")).toBe("plaintext-only");
    await editor.setValue("Packaged smoke test");

    const completed = await $('[aria-label="Completed"]');
    await completed.waitForDisplayed();

    const play = await $('button[aria-label="Play selected cell"]');
    await play.waitForEnabled();
    await play.click();

    const stop = await $('button[aria-label="Stop playback"]');
    await stop.waitForDisplayed();
    await stop.click();
    await play.waitForDisplayed();
  });
});
