namespace OrigoMapStories.UiTests.Pages;

/// <summary>The left-hand menu panel ("Kartinnehåll").</summary>
public class LayerPanel(IPage page)
{
    public ILocator Root => page.Locator("#o-layer-panel");
    public ILocator Title => Root.Locator(".o-lp-header-title");
    public ILocator Hero => Root.Locator(".o-lp-header-hero");
    public ILocator SettingsButton => Root.Locator("#o-lp-settings-btn");
    public ILocator CloseButton => Root.Locator("#o-lp-close-btn");
    public ILocator Status => Root.Locator(".o-lp-status");
    public ILocator Sections => Root.Locator(".o-lp-section-btn");

    public ILocator Section(string label) =>
        Sections.Filter(new() { HasText = label });

    // Has-locators are evaluated relative to the filtered element, so they
    // must not start from Root.
    private ILocator SectionButtonInside(string label) =>
        page.Locator(".o-lp-section-btn").Filter(new() { HasText = label });

    private ILocator SectionItem(string menu) =>
        Root.Locator(".o-lp-section").Filter(new() { Has = SectionButtonInside(menu) });

    public ILocator Item(string menu, string item) =>
        SectionItem(menu)
            .Locator(".o-lp-subitem").Filter(new() { HasTextRegex = new System.Text.RegularExpressions.Regex($@"^\s*{System.Text.RegularExpressions.Regex.Escape(item)}\s*$") });

    public async Task ExpandAsync(string menu)
    {
        var section = Section(menu);
        if (await section.GetAttributeAsync("aria-expanded") != "true") await section.ClickAsync();
        await Assertions.Expect(Section(menu)).ToHaveAttributeAsync("aria-expanded", "true");
    }

    public async Task SelectAsync(string menu, string item)
    {
        await ExpandAsync(menu);
        await Item(menu, item).ClickAsync();
        await Assertions.Expect(Item(menu, item)).ToHaveClassAsync(new System.Text.RegularExpressions.Regex("is-active"));
    }

    /// <summary>Labels of all menu sections, in order.</summary>
    public async Task<IReadOnlyList<string>> SectionLabelsAsync() =>
        (await Sections.Locator("span:first-child").AllInnerTextsAsync()).Select(s => s.Trim()).ToList();

    /// <summary>Labels of the submenus of an expanded section, in order.</summary>
    public async Task<IReadOnlyList<string>> ItemLabelsAsync(string menu)
    {
        await ExpandAsync(menu);
        var items = SectionItem(menu).Locator(".o-lp-subitem");
        return (await items.AllInnerTextsAsync()).Select(s => s.Trim()).ToList();
    }
}
