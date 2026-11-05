namespace OrigoMapStories.UiTests.Pages;

/// <summary>The text panel for the selected submenu, with the rich-text editor.</summary>
public class TextPanel(IPage page)
{
    public ILocator Root => page.Locator("#o-text-panel");
    public ILocator Title => Root.Locator(".o-tp-title");
    public ILocator Content => Root.Locator("#o-tp-editor-mount .ProseMirror");
    public ILocator Toolbar => Root.Locator(".o-editor-toolbar");
    public ILocator Status => Root.Locator(".o-tp-status");
    public ILocator EditButton => Root.Locator("#o-tp-edit-btn");
    public ILocator SaveButton => Root.Locator("#o-tp-save-btn");
    public ILocator CancelButton => Root.Locator("#o-tp-cancel-btn");
    public ILocator SaveAndCloseButton => Root.Locator("#o-tp-save-close-btn");
    public ILocator MapEditorButton => Root.Locator("#o-tp-geojson-btn");
    public ILocator CloseButton => Root.Locator("#o-tp-close-btn");
    /// <summary>The "next submenu" arrow at the end of the text.</summary>
    public ILocator NextButton => Root.Locator("#o-tp-next-btn");
    public ILocator Body => Root.Locator(".o-tp-body");
    public ILocator MapLinks => Content.Locator("span[data-feature-id]");
    public ILocator Images => Content.Locator("img");
    /// <summary>The selectable wrapper around each image (receives the clicks).</summary>
    public ILocator ImageNodes => Content.Locator(".o-image-node");
    private ILocator ImageInput => Toolbar.Locator("input[type='file']");

    public async Task WaitForContentAsync()
    {
        await Assertions.Expect(Root).ToBeVisibleAsync();
        await Assertions.Expect(Content).ToBeVisibleAsync();
    }

    public ILocator ToolbarButton(string cmd) => Toolbar.Locator($"[data-cmd='{cmd}']");

    public async Task StartEditingAsync()
    {
        await EditButton.ClickAsync();
        await Assertions.Expect(SaveButton).ToBeVisibleAsync();
        await Assertions.Expect(Content).ToHaveAttributeAsync("contenteditable", "true");
    }

    /// <summary>Places the cursor at the very end of the document.</summary>
    public async Task MoveCursorToEndAsync()
    {
        // Through Tiptap rather than a click (which could land on a map link and
        // move the map) or focus + Ctrl+End (the caret can stay at the start).
        await Content.EvaluateAsync("el => el.editor.commands.focus('end')");
        // Tiptap moves DOM focus in the next animation frame; keys pressed
        // before that are lost.
        await page.WaitForFunctionAsync("el => el.contains(document.activeElement)", await Content.ElementHandleAsync());
    }

    /// <summary>Types a new paragraph at the end of the document.</summary>
    public async Task AppendParagraphAsync(string text)
    {
        await MoveCursorToEndAsync();
        await page.Keyboard.PressAsync("Enter");
        await page.Keyboard.TypeAsync(text);
    }

    /// <summary>Selects the text of the last paragraph that has text.</summary>
    public Task SelectLastLineAsync() => SelectTextblockAsync(-1);

    /// <summary>Selects the whole text of the n-th paragraph.</summary>
    public Task SelectParagraphAsync(int index) => SelectTextblockAsync(index);

    /// <summary>
    /// Selects a paragraph's text through Tiptap (the editor element carries
    /// its Editor as .editor). Keyboard selection in a contenteditable is
    /// synced into ProseMirror asynchronously and proved flaky in tests.
    /// </summary>
    private async Task SelectTextblockAsync(int index)
    {
        var selected = await Content.EvaluateAsync<string>(
            @"(el, index) => {
                const editor = el.editor;
                const blocks = [];
                editor.state.doc.descendants((node, pos) => {
                    if (node.type.name === 'paragraph' && node.textContent) blocks.push({ from: pos + 1, to: pos + 1 + node.content.size });
                });
                const block = index < 0 ? blocks[blocks.length + index] : blocks[index];
                editor.chain().focus().setTextSelection(block).run();
                const { from, to } = editor.state.selection;
                return editor.state.doc.textBetween(from, to);
            }", index);
        if (string.IsNullOrEmpty(selected)) throw new InvalidOperationException($"Could not select paragraph {index}.");
    }

    /// <summary>Appends <paramref name="count"/> text paragraphs through Tiptap so the text gets long enough to scroll.</summary>
    public Task AppendParagraphsAsync(int count, string text = "Ett långt stycke text som fyller panelen.") =>
        Content.EvaluateAsync(
            @"(el, [count, text]) => {
                const paragraphs = Array.from({ length: count }, (_, i) =>
                    ({ type: 'paragraph', content: [{ type: 'text', text: `${text} ${i + 1}` }] }));
                el.editor.chain().focus('end').insertContent(paragraphs).run();
            }", new object[] { count, text });

    /// <summary>Scrolls the text body (the panel's scroll container) to the bottom and returns its scrollTop.</summary>
    public Task<double> ScrollBodyToBottomAsync() =>
        Body.EvaluateAsync<double>("el => { el.scrollTop = el.scrollHeight; return el.scrollTop; }");

    public Task<double> BodyScrollTopAsync() => Body.EvaluateAsync<double>("el => el.scrollTop");

    /// <summary>
    /// Fills the text until it scrolls, scrolls to the bottom and checks that
    /// the toolbar is still at the top of the visible text area and that the
    /// bold button works on the last paragraph without scrolling back up.
    /// </summary>
    public async Task AssertToolbarStaysUsableAtBottomAsync()
    {
        await AppendParagraphsAsync(60);
        var scrolls = await Body.EvaluateAsync<bool>("el => el.scrollHeight > el.clientHeight + 200");
        Assert.That(scrolls, Is.True, "the text must be long enough to scroll");

        await SelectLastLineAsync();
        var scrollTop = await ScrollBodyToBottomAsync();
        Assert.That(scrollTop, Is.GreaterThan(200), "the text body scrolled down");

        var body = await Body.BoundingBoxAsync() ?? throw new InvalidOperationException("text body has no box");
        var bar = await Toolbar.BoundingBoxAsync() ?? throw new InvalidOperationException("toolbar has no box");
        Assert.That(bar.Y, Is.EqualTo(body.Y).Within(1), "toolbar stuck to the top of the scroll area");
        Assert.That(bar.Y + bar.Height, Is.LessThan(body.Y + body.Height), "toolbar inside the visible text area");
        await Assertions.Expect(ToolbarButton("bold")).ToBeInViewportAsync();

        // The button must be on top of the text, not just inside the box.
        var topElementIsBold = await ToolbarButton("bold").EvaluateAsync<bool>(
            @"btn => {
                const r = btn.getBoundingClientRect();
                const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                return !!hit && btn.contains(hit);
            }");
        Assert.That(topElementIsBold, Is.True, "bold button is not covered by the text");

        await ToolbarButton("bold").ClickAsync();

        Assert.That(await BodyScrollTopAsync(), Is.EqualTo(scrollTop).Within(2), "clicking the toolbar did not need to scroll up");
        await Assertions.Expect(Content.Locator("p").Last.Locator("strong")).ToHaveTextAsync("Ett långt stycke text som fyller panelen. 60");
    }

    public ILocator MapViewLinks => Content.Locator("span.o-map-view-link");

    public async Task InsertImageAsync(string path)
    {
        await ImageInput.SetInputFilesAsync(path);
    }

    public async Task SaveAsync()
    {
        await SaveButton.ClickAsync();
        await Assertions.Expect(Status).ToHaveTextAsync("Sparat!");
    }

    /// <summary>"Spara och stäng": saves and returns to read mode.</summary>
    public async Task SaveAndCloseAsync()
    {
        await SaveAndCloseButton.ClickAsync();
        await Assertions.Expect(EditButton).ToBeVisibleAsync();
        await Assertions.Expect(Content).ToHaveAttributeAsync("contenteditable", "false");
    }

    /// <summary>
    /// Clicks "Avbryt", answering an unsaved-changes prompt with accept or
    /// dismiss. Returns the prompts shown (empty when nothing was unsaved).
    /// </summary>
    public Task<List<string>> CancelAsync(bool accept = true) =>
        ConfirmDialog.HandleAsync(page, () => CancelButton.ClickAsync(), accept);

    /// <summary>Clicks the header ×, answering an unsaved-changes prompt.</summary>
    public Task<List<string>> CloseAsync(bool accept = true) =>
        ConfirmDialog.HandleAsync(page, () => CloseButton.ClickAsync(), accept);

    /// <summary>Presses Escape, answering an unsaved-changes prompt.</summary>
    public Task<List<string>> PressEscapeAsync(bool accept = true) =>
        ConfirmDialog.HandleAsync(page, () => page.Keyboard.PressAsync("Escape"), accept);
}
