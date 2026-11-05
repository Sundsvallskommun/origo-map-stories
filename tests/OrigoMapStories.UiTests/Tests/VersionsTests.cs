using OrigoMapStories.UiTests.Infrastructure;
using OrigoMapStories.UiTests.Pages;

namespace OrigoMapStories.UiTests.Tests;

/// <summary>The "Versionshistorik" tab: listing, restoring and deleting versions.</summary>
public class VersionsTests : UiTestBase
{
    private MapPage _map = null!;

    /// <summary>Saves a text through the API to create a new version quickly.</summary>
    private async Task SaveTextViaApiAsync(string layer, string paragraph)
    {
        var token = await GetAdminTokenAsync();
        var doc = new { type = "doc", content = new object[] { new { type = "paragraph", content = new[] { new { type = "text", text = paragraph } } } } };
        var res = await Page.APIRequest.PostAsync($"/api/content/{layer}", new()
        {
            Headers = new Dictionary<string, string> { ["Authorization"] = $"Bearer {token}" },
            DataObject = doc
        });
        Assert.That(res.Ok, Is.True, $"saving {layer} via API failed: {res.Status}");
    }

    private async Task<VersionsTab> OpenVersionsAsync()
    {
        _map = await OpenAsAdminAsync();
        var panel = await _map.OpenLayerPanelAsync();
        await _map.SiteConfig.OpenAsync(panel);
        await _map.SiteConfig.SelectTabAsync("versioner");
        return _map.SiteConfig.Versions;
    }

    [Test]
    public async Task Lists_the_seeded_version_as_current()
    {
        var versions = await OpenVersionsAsync();

        await versions.WaitForRowsAsync(1);
        await Expect(versions.CurrentRow).ToHaveAttributeAsync("data-version-id", "1");
        await Expect(versions.CurrentRow).ToContainTextAsync("Aktuell");
        await Expect(versions.CurrentRow).ToContainTextAsync("Migrering");
        await Expect(versions.RestoreButton(1)).ToHaveCountAsync(0);
        await Expect(versions.DeleteButton(1)).ToHaveCountAsync(0);
        await Expect(versions.ExportButton(1)).ToBeVisibleAsync();
        await Expect(_map.SiteConfig.SaveButton).ToBeHiddenAsync();
    }

    [Test]
    public async Task Save_button_returns_when_leaving_the_tab()
    {
        await OpenVersionsAsync();
        await _map.SiteConfig.SelectTabAsync("menyer");

        await Expect(_map.SiteConfig.SaveButton).ToBeVisibleAsync();
    }

    [Test]
    public async Task New_save_becomes_the_current_version()
    {
        await SaveTextViaApiAsync("Test_Kollektivtrafik", "Ändrad text");
        var versions = await OpenVersionsAsync();

        await versions.WaitForRowsAsync(2);
        await Expect(versions.CurrentRow).ToHaveAttributeAsync("data-version-id", "2");
        await Expect(versions.Description(2)).ToHaveTextAsync("Sparade text: Trafik › Kollektivtrafik");
        await Expect(versions.RestoreButton(1)).ToBeVisibleAsync();
        await Expect(versions.DeleteButton(1)).ToBeVisibleAsync();
    }

    [Test]
    public async Task Restoring_an_old_version_brings_back_its_content_and_keeps_the_current_one()
    {
        await SaveTextViaApiAsync("Test_Kollektivtrafik", "Ändrad text");
        var versions = await OpenVersionsAsync();
        await versions.WaitForRowsAsync(2);

        await versions.RestoreAsync(1);

        await versions.WaitForRowsAsync(3);
        await Expect(versions.CurrentRow).ToHaveAttributeAsync("data-version-id", "3");
        await Expect(versions.Description(3)).ToHaveTextAsync("Återställd från version 1");
        await Expect(versions.Row(2)).ToBeVisibleAsync();
        await Expect(_map.SiteConfig.Status).ToHaveTextAsync("Version 1 återställd som version 3.");

        await _map.SiteConfig.CloseAsync();
        var text = await _map.OpenLayerAsync("Trafik", "Kollektivtrafik");
        await Expect(text.Content.Locator("h1")).ToHaveTextAsync("Kollektivtrafik");
        await Expect(text.Content).Not.ToContainTextAsync("Ändrad text");
    }

    [Test]
    public async Task Restoring_a_config_change_updates_menus_in_the_open_editor_and_panel()
    {
        var versions = await OpenVersionsAsync();
        await _map.SiteConfig.SelectTabAsync("menyer");
        await _map.SiteConfig.MenuLabel(0).FillAsync("Boende");
        await _map.SiteConfig.SaveAsync();
        Assert.That(await _map.LayerPanel.SectionLabelsAsync(), Does.Contain("Boende"));

        await _map.SiteConfig.SelectTabAsync("versioner");
        await versions.WaitForRowsAsync(2);
        await versions.RestoreAsync(1);
        await versions.WaitForRowsAsync(3);

        await _map.SiteConfig.SelectTabAsync("menyer");
        await Expect(_map.SiteConfig.MenuLabel(0)).ToHaveValueAsync("Bostäder");
        Assert.That(await _map.LayerPanel.SectionLabelsAsync(), Is.EqualTo(new[] { "Bostäder", "Trafik" }));
    }

    [Test]
    public async Task Deleting_an_old_version_removes_it()
    {
        await SaveTextViaApiAsync("Test_Kollektivtrafik", "Ändrad text");
        var versions = await OpenVersionsAsync();
        await versions.WaitForRowsAsync(2);

        await versions.DeleteAsync(1);

        await versions.WaitForRowsAsync(1);
        await Expect(versions.Row(1)).ToHaveCountAsync(0);
        await Expect(_map.SiteConfig.Status).ToHaveTextAsync("Version 1 raderad.");
        Assert.That(await TestDatabase.CountAsync("SELECT count(*) FROM version"), Is.EqualTo(1));
    }

    [Test]
    public async Task Dismissing_the_delete_confirmation_keeps_the_version()
    {
        await SaveTextViaApiAsync("Test_Kollektivtrafik", "Ändrad text");
        var versions = await OpenVersionsAsync();
        await versions.WaitForRowsAsync(2);

        await versions.DeleteAsync(1, accept: false);

        await Page.WaitForTimeoutAsync(300);
        await versions.WaitForRowsAsync(2);
        Assert.That(await TestDatabase.CountAsync("SELECT count(*) FROM version"), Is.EqualTo(2));
    }

    [Test]
    public async Task Deleting_versions_removes_file_contents_nobody_uses()
    {
        await SaveTextViaApiAsync("Test_Kollektivtrafik", "Första ändringen");
        await SaveTextViaApiAsync("Test_Kollektivtrafik", "Andra ändringen");
        var blobsBefore = await TestDatabase.CountAsync("SELECT count(*) FROM blob");
        var versions = await OpenVersionsAsync();
        await versions.WaitForRowsAsync(3);

        await versions.DeleteAsync(2);
        await versions.WaitForRowsAsync(2);

        Assert.That(await TestDatabase.CountAsync("SELECT count(*) FROM blob"), Is.EqualTo(blobsBefore - 1),
            "the text only used by version 2 should be garbage-collected");
    }

    [Test]
    public async Task Rejected_token_on_the_versions_tab_asks_for_login()
    {
        _map = await OpenAsAdminAsync();
        var panel = await _map.OpenLayerPanelAsync();
        await _map.SiteConfig.OpenAsync(panel);
        await Page.EvaluateAsync("() => localStorage.setItem('cms_token', 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYWRtaW4iLCJleHAiOjk5OTk5OTk5OTl9.bad')");

        await _map.SiteConfig.Tab("versioner").ClickAsync();

        await Expect(_map.Login.Root).ToBeVisibleAsync();
        await _map.Login.LoginAsync(TestSettings.AdminPassword);
        await _map.SiteConfig.SelectTabAsync("menyer");
        await _map.SiteConfig.SelectTabAsync("versioner");
        await _map.SiteConfig.Versions.WaitForRowsAsync(1);
    }
}
