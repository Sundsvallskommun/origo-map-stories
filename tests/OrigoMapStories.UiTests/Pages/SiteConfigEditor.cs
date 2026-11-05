namespace OrigoMapStories.UiTests.Pages;

/// <summary>The "Sajtkonfiguration" overlay with its three tabs.</summary>
public class SiteConfigEditor(IPage page)
{
    public IPage Page { get; } = page;

    public ILocator Root => Page.Locator(".o-cfg-overlay");
    public ILocator Status => Root.Locator("#o-cfg-status");
    public ILocator SaveButton => Root.Locator("#o-cfg-save-btn");
    public ILocator CancelButton => Root.Locator("#o-cfg-cancel");
    public ILocator SaveAndCloseButton => Root.Locator("#o-cfg-save-close-btn");
    public ILocator CloseButton => Root.Locator("#o-cfg-x");
    public ILocator Tab(string tab) => Root.Locator($".o-cfg-tab-btn[data-tab='{tab}']");
    public VersionsTab Versions => new(Page);

    // Menyer
    public ILocator MenuGroups => Root.Locator(".o-cfg-menu-group");
    public ILocator MenuLabel(int menu) => MenuGroups.Nth(menu).Locator(".o-cfg-menu-label");
    public ILocator Items(int menu) => MenuGroups.Nth(menu).Locator(".o-cfg-item");
    public ILocator ItemLabel(int menu, int item) => Items(menu).Nth(item).Locator(".o-cfg-item-label");
    public ILocator AddMenuButton => Root.Locator("#o-cfg-add-menu");
    public ILocator AddItemButton(int menu) => MenuGroups.Nth(menu).Locator(".o-cfg-add-item-btn");
    public ILocator DeleteMenuButton(int menu) => MenuGroups.Nth(menu).Locator(".o-cfg-menu-group-header .o-cfg-del-btn");
    public ILocator DeleteItemButton(int menu, int item) => Items(menu).Nth(item).Locator(".o-cfg-item-del");
    public ILocator MoveItemButton(int menu, int item, string dir) => Items(menu).Nth(item).Locator($".o-cfg-item-order[data-dir='{dir}']");
    public ILocator MoveMenuButton(int menu, string dir) => MenuGroups.Nth(menu).Locator($".o-cfg-menu-group-header .o-cfg-order-btn[data-dir='{dir}']");

    // Grafisk profil (asset = header-image | button-icon | corner-logo)
    public ILocator HeaderText => Root.Locator("#o-cfg-header-text");
    public ILocator AssetError(string asset) => Root.Locator($"#o-cfg-err-{asset}");
    public ILocator AssetThumb(string asset) => Root.Locator($"#o-cfg-thumb-{asset} img");

    public async Task OpenAsync(LayerPanel panel)
    {
        await panel.SettingsButton.ClickAsync();
        await Assertions.Expect(Root).ToBeVisibleAsync();
    }

    public async Task SelectTabAsync(string tab)
    {
        await Tab(tab).ClickAsync();
        await Assertions.Expect(Tab(tab)).ToHaveClassAsync(new System.Text.RegularExpressions.Regex("is-active"));
    }

    public Task UploadAssetAsync(string asset, string path) =>
        Root.Locator($"#o-cfg-file-{asset}").SetInputFilesAsync(path);

    public async Task SaveAsync()
    {
        await SaveButton.ClickAsync();
        await Assertions.Expect(Status).ToHaveTextAsync("Sparades!");
    }

    /// <summary>Clicks ✕ with nothing unsaved and waits for the editor to close.</summary>
    public async Task CloseAsync()
    {
        await CloseButton.ClickAsync();
        await Assertions.Expect(Root).ToBeHiddenAsync();
    }

    /// <summary>"Spara och stäng": saves and waits for the editor to close.</summary>
    public async Task SaveAndCloseAsync()
    {
        await SaveAndCloseButton.ClickAsync();
        await Assertions.Expect(Root).ToBeHiddenAsync();
    }

    /// <summary>
    /// Clicks "Avbryt", answering an unsaved-changes prompt with accept or
    /// dismiss. Returns the prompts shown (empty when nothing was unsaved).
    /// </summary>
    public Task<List<string>> CancelAsync(bool accept = true) =>
        ConfirmDialog.HandleAsync(Page, () => CancelButton.ClickAsync(), accept);

    /// <summary>Clicks ✕, answering an unsaved-changes prompt.</summary>
    public Task<List<string>> CloseWithPromptAsync(bool accept = true) =>
        ConfirmDialog.HandleAsync(Page, () => CloseButton.ClickAsync(), accept);

    /// <summary>Presses Escape, answering an unsaved-changes prompt.</summary>
    public Task<List<string>> PressEscapeAsync(bool accept = true) =>
        ConfirmDialog.HandleAsync(Page, () => Page.Keyboard.PressAsync("Escape"), accept);
}
