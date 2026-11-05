namespace OrigoMapStories.UiTests.Pages;

/// <summary>The "Koppla till karta" dialog opened from the 🔗 toolbar button.</summary>
public class LinkMapModal(IPage page)
{
    public ILocator Root => page.Locator(".o-mlink-overlay:not(.o-admin-login-overlay)");
    public ILocator Warning => Root.Locator(".o-mlink-warning");
    public ILocator OwnLayerOption => Root.Locator("[data-action='feature']");
    public ILocator MapViewOption => Root.Locator("[data-action='mapview']");
    public ILocator LayerSelect => Root.Locator(".o-mlink-layer-select");
    public ILocator PickFromLayerButton => Root.Locator("[data-action='layerfeature']");
    public ILocator RemoveButton => Root.Locator("[data-action='remove']");
    public ILocator CancelButton => Root.Locator(".o-mlink-footer [data-action='cancel']");
    public ILocator CloseButton => Root.Locator(".o-mlink-close");

    public async Task OpenAsync(TextPanel text)
    {
        await text.ToolbarButton("mapLink").ClickAsync();
        await Assertions.Expect(Root).ToBeVisibleAsync();
    }

    public async Task ChooseAsync(ILocator option)
    {
        await option.ClickAsync();
        await Assertions.Expect(Root).ToHaveCountAsync(0);
    }
}
