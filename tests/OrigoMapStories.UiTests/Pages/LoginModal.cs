namespace OrigoMapStories.UiTests.Pages;

/// <summary>The admin login modal shown on the ?admin link.</summary>
public class LoginModal(IPage page)
{
    public ILocator Root => page.Locator(".o-admin-login-overlay");
    public ILocator Password => page.Locator("#o-admin-login-pw");
    public ILocator Error => page.Locator(".o-admin-login-err");
    public ILocator Warning => Root.Locator(".o-mlink-warning");
    public ILocator LoginButton => Root.Locator("[data-action='login']");
    public ILocator CancelButton => Root.Locator(".o-mlink-footer [data-action='cancel']");

    public async Task SubmitAsync(string password)
    {
        await Assertions.Expect(Root).ToBeVisibleAsync();
        await Password.FillAsync(password);
        await LoginButton.ClickAsync();
    }

    public async Task LoginAsync(string password)
    {
        await SubmitAsync(password);
        await Assertions.Expect(Root).ToBeHiddenAsync();
    }
}
