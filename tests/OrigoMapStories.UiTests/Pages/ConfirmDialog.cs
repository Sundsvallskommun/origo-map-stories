namespace OrigoMapStories.UiTests.Pages;

/// <summary>
/// Handles the window.confirm() the editors show before discarding unsaved
/// changes (also confirms raised inside the map editor's iframe).
/// </summary>
public static class ConfirmDialog
{
    public const string DiscardMessage = "Du har osparade ändringar. Vill du avbryta utan att spara?";

    /// <summary>
    /// Runs <paramref name="action"/>, answers every confirm it raises with
    /// accept or dismiss, and returns the messages of the dialogs that were
    /// shown (empty when there was no prompt). Without a handler Playwright
    /// dismisses dialogs on its own.
    /// </summary>
    public static async Task<List<string>> HandleAsync(IPage page, Func<Task> action, bool accept = true)
    {
        var messages = new List<string>();
        void Handler(object? _, IDialog dialog)
        {
            lock (messages) messages.Add(dialog.Message);
            _ = accept ? dialog.AcceptAsync() : dialog.DismissAsync();
        }
        page.Dialog += Handler;
        try
        {
            await action();
            // The dialog event can arrive just after the click returns.
            await page.WaitForTimeoutAsync(200);
        }
        finally
        {
            page.Dialog -= Handler;
        }
        return messages;
    }
}
