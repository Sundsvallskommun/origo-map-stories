namespace OrigoMapStories.UiTests.Pages;

/// <summary>The "Versionshistorik" tab inside the site configuration.</summary>
public class VersionsTab(IPage page)
{
    private ILocator Root => page.Locator(".o-cfg-overlay [data-tabpanel='versioner']");

    public ILocator Table => Root.Locator(".o-cfg-versions-table");
    public ILocator Rows => Table.Locator("tbody tr");
    public ILocator Row(int versionId) => Table.Locator($"tr[data-version-id='{versionId}']");
    public ILocator CurrentRow => Table.Locator("tr.is-current");
    public ILocator RestoreButton(int versionId) => Row(versionId).Locator("[data-action='restore']");
    public ILocator ExportButton(int versionId) => Row(versionId).Locator("[data-action='export']");
    public ILocator DeleteButton(int versionId) => Row(versionId).Locator("[data-action='delete']");
    public ILocator ExportCurrentButton => Root.Locator("#o-cfg-export-current");
    public ILocator ImportInput => Root.Locator("#o-cfg-import-file");

    public async Task WaitForRowsAsync(int count) =>
        await Assertions.Expect(Rows).ToHaveCountAsync(count);

    /// <summary>Description text of a version row (4th column).</summary>
    public ILocator Description(int versionId) => Row(versionId).Locator("td").Nth(3);

    /// <summary>Clicks a button that opens a confirm() dialog and accepts or dismisses it.</summary>
    public async Task ClickWithConfirmAsync(ILocator button, bool accept = true)
    {
        void Handler(object? _, IDialog dialog)
        {
            _ = accept ? dialog.AcceptAsync() : dialog.DismissAsync();
        }
        page.Dialog += Handler;
        try
        {
            await button.ClickAsync();
        }
        finally
        {
            page.Dialog -= Handler;
        }
    }

    public async Task RestoreAsync(int versionId) => await ClickWithConfirmAsync(RestoreButton(versionId));
    public async Task DeleteAsync(int versionId, bool accept = true) => await ClickWithConfirmAsync(DeleteButton(versionId), accept);

    /// <summary>Starts an export and returns the downloaded file.</summary>
    public async Task<IDownload> ExportAsync(ILocator button) =>
        await page.RunAndWaitForDownloadAsync(() => button.ClickAsync());

    /// <summary>Chooses a zip file for import and accepts the confirmation.</summary>
    public async Task ImportAsync(string zipPath)
    {
        void Handler(object? _, IDialog dialog) => _ = dialog.AcceptAsync();
        page.Dialog += Handler;
        try
        {
            await ImportInput.SetInputFilesAsync(zipPath);
        }
        finally
        {
            // The dialog appears right after the change event; give it a moment.
            await page.WaitForTimeoutAsync(200);
            page.Dialog -= Handler;
        }
    }
}
