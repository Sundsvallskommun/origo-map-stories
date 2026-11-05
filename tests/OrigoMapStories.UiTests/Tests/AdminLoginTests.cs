using System.Text;
using OrigoMapStories.UiTests.Infrastructure;

namespace OrigoMapStories.UiTests.Tests;

/// <summary>The ?admin link: login modal, token handling and expired sessions.</summary>
public class AdminLoginTests : UiTestBase
{
    /// <summary>A JWT-shaped token; the client only decodes the payload, the server verifies the signature.</summary>
    private static string FakeToken(long exp)
    {
        static string B64(string json) => Convert.ToBase64String(Encoding.UTF8.GetBytes(json)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        return $"{B64("{\"alg\":\"HS256\",\"typ\":\"JWT\"}")}.{B64($"{{\"role\":\"admin\",\"exp\":{exp}}}")}.invalidsignature";
    }

    private async Task SetTokenAsync(string token)
    {
        await Page.GotoAsync("/");
        await Page.EvaluateAsync("t => localStorage.setItem('cms_token', t)", token);
    }

    [Test]
    public async Task Admin_link_shows_login_modal()
    {
        await Map.GotoAsync(admin: true);

        await Expect(Map.Login.Root).ToBeVisibleAsync();
        await Expect(Map.Login.Password).ToBeFocusedAsync();
    }

    [Test]
    public async Task Wrong_password_shows_error_and_keeps_modal_open()
    {
        await Map.GotoAsync(admin: true);
        await Map.Login.SubmitAsync("fel-lösenord");

        await Expect(Map.Login.Error).ToHaveTextAsync("Fel lösenord.");
        await Expect(Map.Login.Root).ToBeVisibleAsync();
    }

    [Test]
    public async Task Empty_password_asks_for_password()
    {
        await Map.GotoAsync(admin: true);
        await Map.Login.LoginButton.ClickAsync();

        await Expect(Map.Login.Error).ToHaveTextAsync("Ange lösenord.");
    }

    [Test]
    public async Task Correct_password_shows_admin_controls()
    {
        var map = await OpenAsAdminAsync();
        var panel = await map.OpenLayerPanelAsync();

        await Expect(panel.SettingsButton).ToBeVisibleAsync();
        var text = await map.OpenLayerAsync("Bostäder", "Nuläge");
        await Expect(text.EditButton).ToBeVisibleAsync();
        await Expect(text.MapEditorButton).ToBeVisibleAsync();
    }

    [Test]
    public async Task Login_with_enter_key_works()
    {
        await Map.GotoAsync(admin: true);
        await Map.Login.Password.FillAsync(TestSettings.AdminPassword);
        await Map.Login.Password.PressAsync("Enter");

        await Expect(Map.Login.Root).ToBeHiddenAsync();
        var panel = await Map.OpenLayerPanelAsync();
        await Expect(panel.SettingsButton).ToBeVisibleAsync();
    }

    [Test]
    public async Task Cancel_closes_modal_without_admin_controls()
    {
        await Map.GotoAsync(admin: true);
        await Map.Login.CancelButton.ClickAsync();

        await Expect(Map.Login.Root).ToBeHiddenAsync();
        var panel = await Map.OpenLayerPanelAsync();
        await Expect(panel.SettingsButton).ToHaveCountAsync(0);
    }

    [Test]
    public async Task Valid_token_skips_the_login_modal()
    {
        await SetTokenAsync(await GetAdminTokenAsync());

        await Map.GotoAsync(admin: true);

        await Expect(Map.Login.Root).ToHaveCountAsync(0);
        var panel = await Map.OpenLayerPanelAsync();
        await Expect(panel.SettingsButton).ToBeVisibleAsync();
    }

    [Test]
    public async Task Expired_token_shows_the_login_modal_again()
    {
        await SetTokenAsync(FakeToken(exp: 1));

        await Map.GotoAsync(admin: true);

        await Expect(Map.Login.Root).ToBeVisibleAsync();
    }

    [Test]
    public async Task Save_with_rejected_token_asks_for_login_and_keeps_the_draft()
    {
        var map = await OpenAsAdminAsync();
        var text = await map.OpenLayerAsync("Bostäder", "Nuläge");
        await text.StartEditingAsync();
        await text.AppendParagraphAsync("Utkast som inte får försvinna");

        // The client still thinks the session is valid, but the server rejects the token.
        await Page.EvaluateAsync("t => localStorage.setItem('cms_token', t)",
            FakeToken(DateTimeOffset.UtcNow.AddHours(1).ToUnixTimeSeconds()));
        await text.SaveButton.ClickAsync();

        await Expect(map.Login.Root).ToBeVisibleAsync();
        await Expect(map.Login.Warning).ToContainTextAsync("Sessionen har gått ut");
        await Expect(text.Content).ToContainTextAsync("Utkast som inte får försvinna");

        // Logging in again retries the save.
        await map.Login.LoginAsync(TestSettings.AdminPassword);
        await Expect(text.Status).ToHaveTextAsync("Sparat!");
        var saved = await ApiGetJsonAsync("/api/content/Test_Bostader_Nulage");
        Assert.That(saved.ToString(), Does.Contain("Utkast som inte får försvinna"));
    }
}
