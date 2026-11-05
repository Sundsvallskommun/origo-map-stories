using System.Text.Json;
using System.Text.RegularExpressions;
using OrigoMapStories.UiTests.Infrastructure;
using OrigoMapStories.UiTests.Pages;

namespace OrigoMapStories.UiTests.Tests;

/// <summary>
/// The panel when the content can't be fetched ("Databasen inte uppkopplad",
/// everything locked) and when the database is empty ("Databasen saknar
/// innehåll", the admin keeps the site configuration).
/// </summary>
public class DatabaseStatusTests : UiTestBase
{
    private const string OutageMenu = "Databasen inte uppkopplad";
    private const string EmptyMenu = "Databasen saknar innehåll";
    private const string HowTo = "Gör så här";
    private const string ReadmeUrl = "https://github.com/Sundsvallskommun/origo-map-stories#readme";

    private readonly List<string> _writes = [];
    private readonly List<string> _contentRequests = [];

    [SetUp]
    public void RecordRequests()
    {
        // NUnit shares one fixture instance between the tests.
        _writes.Clear();
        _contentRequests.Clear();
        JsErrors.Clear();
        Page.Request += (_, request) =>
        {
            if (request.Method != "GET") _writes.Add($"{request.Method} {request.Url}");
            if (request.Url.Contains("/api/content/")) _contentRequests.Add(request.Url);
        };
    }

    public enum Failure { NoConnection, ServerError, HtmlInsteadOfJson }

    private Task BreakAsync(string urlGlob, Failure failure) => Page.RouteAsync(urlGlob, route => failure switch
    {
        Failure.NoConnection => route.AbortAsync("connectionrefused"),
        Failure.ServerError => route.FulfillAsync(new() { Status = 500, ContentType = "application/json", Body = "{\"error\":\"Serverfel\"}" }),
        _ => route.FulfillAsync(new() { Status = 200, ContentType = "text/html", Body = "<html>Bad gateway</html>" })
    });

    private async Task SimulateOutageAsync(Failure failure = Failure.NoConnection)
    {
        await BreakAsync("**/api/**", failure);
        await BreakAsync("**/content-files/**", failure);
    }

    private async Task<TextPanel> OpenHowToAsync(MapPage map, string menu)
    {
        var text = await map.OpenLayerAsync(menu, HowTo);
        await Expect(text.Title).ToHaveTextAsync($"{menu} – {HowTo}");
        return text;
    }

    private void AssertNoErrors() => Assert.That(JsErrors, Is.Empty);

    // ─── Outage ──────────────────────────────────────────────────────────────

    [TestCase(Failure.NoConnection)]
    [TestCase(Failure.ServerError)]
    [TestCase(Failure.HtmlInsteadOfJson)]
    public async Task Any_failure_replaces_the_menus_with_the_outage_menu(Failure failure)
    {
        await SimulateOutageAsync(failure);
        await Map.GotoAsync();
        var panel = await Map.OpenLayerPanelAsync();

        Assert.That(await panel.SectionLabelsAsync(), Is.EqualTo(new[] { OutageMenu }));
        Assert.That(await panel.ItemLabelsAsync(OutageMenu), Is.EqualTo(new[] { HowTo }));
    }

    [TestCase("**/api/site-config")]
    [TestCase("**/api/content-catalog")]
    public async Task Failing_config_or_catalog_alone_is_an_outage(string urlGlob)
    {
        await BreakAsync(urlGlob, Failure.ServerError);
        await Map.GotoAsync();
        var panel = await Map.OpenLayerPanelAsync();

        Assert.That(await panel.SectionLabelsAsync(), Is.EqualTo(new[] { OutageMenu }));
    }

    [Test]
    public async Task The_text_comes_from_the_file_next_to_the_plugin()
    {
        await SimulateOutageAsync();
        var fileRequests = new List<string>();
        Page.Request += (_, request) => { if (request.Url.Contains("gor-sa-har")) fileRequests.Add(request.Url); };
        await Map.GotoAsync();

        var text = await OpenHowToAsync(Map, OutageMenu);

        Assert.That(fileRequests.Single(), Does.EndWith("/plugins/gor-sa-har.json"));
        await Expect(text.Content.Locator("h1")).ToHaveTextAsync(HowTo);
        await Expect(text.Content.Locator("h2", new() { HasText = "Installera PostgreSQL och PostGIS" })).ToBeVisibleAsync();
        await Expect(text.Content.Locator("pre").First).ToContainTextAsync("sudo apt update");
        await Expect(text.Content.Locator("li", new() { HasText = "Connection refused" })).ToBeVisibleAsync();
        await Expect(text.Content.Locator("table")).ToHaveCountAsync(0);
        await Expect(text.Content).ToHaveAttributeAsync("contenteditable", "false");
        Assert.That(_contentRequests, Is.Empty);
        AssertNoErrors();
    }

    [TestCase(true)]
    [TestCase(false)]
    public async Task The_built_in_text_is_shown_when_the_file_cannot_be_used(bool fileMissing)
    {
        await SimulateOutageAsync();
        await Page.RouteAsync("**/gor-sa-har.json", route => fileMissing
            ? route.FulfillAsync(new() { Status = 404, Body = "" })
            : route.FulfillAsync(new() { Status = 200, ContentType = "application/json", Body = "{\"not\":\"a document\"}" }));
        await Map.GotoAsync();

        var text = await OpenHowToAsync(Map, OutageMenu);

        await Expect(text.Content).ToContainTextAsync("en databas som inte går att nå just nu");
        await Expect(text.Content.Locator($"a[href='{ReadmeUrl}']")).ToBeVisibleAsync();
    }

    [TestCase(false)]
    [TestCase(true)]
    public async Task The_readme_link_opens_from_the_read_only_text(bool fileMissing)
    {
        await SimulateOutageAsync();
        if (fileMissing) await Page.RouteAsync("**/gor-sa-har.json", route => route.AbortAsync());
        await Context.RouteAsync("https://github.com/**", route =>
            route.FulfillAsync(new() { Status = 200, ContentType = "text/html", Body = "<title>README</title>" }));
        await Map.GotoAsync();
        var text = await OpenHowToAsync(Map, OutageMenu);

        var link = text.Content.Locator("a", new() { HasText = "README-filen på GitHub" });
        await Expect(link).ToHaveAttributeAsync("href", ReadmeUrl);
        var popup = await Page.RunAndWaitForPopupAsync(() => link.ClickAsync());

        Assert.That(popup.Url, Is.EqualTo(ReadmeUrl));
    }

    [Test]
    public async Task Nothing_can_be_edited_or_saved_even_with_a_valid_admin_token()
    {
        var token = await GetAdminTokenAsync();
        await SimulateOutageAsync();
        await Page.AddInitScriptAsync($"localStorage.setItem('cms_token', {JsonSerializer.Serialize(token)});");
        await Map.GotoAsync(admin: true);

        var panel = await Map.OpenLayerPanelAsync();
        await Expect(panel.SettingsButton).ToHaveCountAsync(0);

        var text = await OpenHowToAsync(Map, OutageMenu);
        await Expect(text.EditButton).ToBeHiddenAsync();
        await Expect(text.MapEditorButton).ToBeHiddenAsync();
        await Expect(text.SaveButton).ToBeHiddenAsync();
        await Expect(text.SaveAndCloseButton).ToBeHiddenAsync();
        await Expect(text.NextButton).ToBeHiddenAsync();
        await Expect(text.Content).ToHaveAttributeAsync("contenteditable", "false");

        // The hidden buttons do nothing either.
        await Page.EvaluateAsync(@"() => ['#o-tp-edit-btn', '#o-tp-save-btn', '#o-tp-save-close-btn', '#o-tp-geojson-btn']
            .forEach(sel => document.querySelector(sel).click())");
        await Expect(text.Content).ToHaveAttributeAsync("contenteditable", "false");
        await Expect(Page.Locator("#o-map-editor-modal")).ToHaveCountAsync(0);

        Assert.That(_writes, Is.Empty);
        Assert.That(_contentRequests, Is.Empty);
        AssertNoErrors();
    }

    [Test]
    public async Task The_admin_link_does_not_ask_for_a_login_during_an_outage()
    {
        await SimulateOutageAsync();
        await Map.GotoAsync(admin: true);

        await Expect(Page.Locator(".o-admin-login-overlay")).ToHaveCountAsync(0);
        Assert.That(_writes, Is.Empty);
    }

    [Test]
    public async Task The_map_keeps_working_during_an_outage()
    {
        await SimulateOutageAsync();
        await Map.GotoAsync();
        await OpenHowToAsync(Map, OutageMenu);

        await Expect(Page.Locator(".ol-viewport canvas").First).ToBeVisibleAsync();
        Assert.That(await Map.ResolutionAsync(), Is.GreaterThan(0));
        var layers = await Page.EvaluateAsync<int[]>(
            @"() => {
                const all = origo.api().getLayers();
                return [all.length, all.filter(l => l.get('contentLayer')).length];
            }");
        Assert.That(layers[0], Is.GreaterThan(0), "Origo's own layers");
        Assert.That(layers[1], Is.EqualTo(0), "no content layers from the old fallback");
        await Expect(Map.LayerPanel.Status).ToHaveTextAsync("");
    }

    [Test]
    public async Task Closing_and_reopening_the_outage_text_stays_quiet()
    {
        await SimulateOutageAsync();
        await Map.GotoAsync();
        var text = await OpenHowToAsync(Map, OutageMenu);

        await text.CloseButton.ClickAsync();
        await Expect(text.Root).ToHaveCountAsync(0);
        await Expect(Map.LayerPanel.Item(OutageMenu, HowTo)).Not.ToHaveClassAsync(new Regex("is-active"));

        await OpenHowToAsync(Map, OutageMenu);
        await Map.LayerPanel.CloseButton.ClickAsync();
        await Expect(Map.LayerPanel.Root).ToHaveCountAsync(0);

        Assert.That(_writes, Is.Empty);
        AssertNoErrors();
    }

    // ─── Empty database (a really empty one, not a mocked answer) ────────────

    [Test]
    public async Task An_empty_database_gets_its_own_menu_and_text()
    {
        await TestDatabase.ClearAsync();
        var fileRequests = new List<string>();
        Page.Request += (_, request) => { if (request.Url.Contains("gor-sa-har")) fileRequests.Add(request.Url); };
        await Map.GotoAsync();
        var panel = await Map.OpenLayerPanelAsync();

        Assert.That(await panel.SectionLabelsAsync(), Is.EqualTo(new[] { EmptyMenu }));
        await Expect(panel.SettingsButton).ToHaveCountAsync(0);

        var text = await OpenHowToAsync(Map, EmptyMenu);
        await Expect(text.Content).ToContainTextAsync("Sajtkonfiguration → Versionshistorik");
        await Expect(text.Content).ToContainTextAsync("scripts/import-content-folder.js");
        await Expect(text.EditButton).ToBeHiddenAsync();
        Assert.That(fileRequests, Is.Empty);
        Assert.That(_contentRequests, Is.Empty);
        Assert.That(_writes, Is.Empty);
    }

    [Test]
    public async Task The_admin_reaches_the_site_config_on_an_empty_database_and_can_build_menus()
    {
        await TestDatabase.ClearAsync();
        var map = await OpenAsAdminAsync();
        var panel = await map.OpenLayerPanelAsync();
        Assert.That(await panel.SectionLabelsAsync(), Is.EqualTo(new[] { EmptyMenu }));

        // The built-in text itself can't be edited, not even by the admin.
        var text = await OpenHowToAsync(map, EmptyMenu);
        await Expect(text.EditButton).ToBeHiddenAsync();
        await Expect(text.MapEditorButton).ToBeHiddenAsync();

        await map.SiteConfig.OpenAsync(panel);
        await map.SiteConfig.SelectTabAsync("versioner");
        await Expect(map.SiteConfig.Versions.ImportInput).ToBeAttachedAsync();

        // Without configured menus or catalog layers the editor starts empty.
        await map.SiteConfig.SelectTabAsync("menyer");
        await Expect(map.SiteConfig.MenuGroups).ToHaveCountAsync(0);
        await map.SiteConfig.AddMenuButton.ClickAsync();
        await map.SiteConfig.MenuLabel(0).FillAsync("Natur");
        await map.SiteConfig.AddItemButton(0).ClickAsync();
        await map.SiteConfig.ItemLabel(0, 0).FillAsync("Skog");
        await map.SiteConfig.SaveAsync();
        await map.SiteConfig.CloseAsync();

        // Saved menus end the empty state right away, and its text closes with it.
        await Expect(text.Root).ToHaveCountAsync(0);
        Assert.That(await panel.SectionLabelsAsync(), Is.EqualTo(new[] { "Natur" }));
    }

    // ─── Normal content is not misclassified ─────────────────────────────────

    [Test]
    public async Task Normal_content_shows_the_normal_menus_and_text()
    {
        await Map.GotoAsync();
        var text = await Map.OpenLayerAsync("Bostäder", "Nuläge");

        Assert.That(await Map.LayerPanel.SectionLabelsAsync(), Is.EqualTo(new[] { "Bostäder", "Trafik" }));
        await Expect(Map.LayerPanel.Status).ToHaveTextAsync("Valt lager visas i kartan.");
        Assert.That(_contentRequests, Is.Not.Empty);
        await Expect(text.Root).ToBeVisibleAsync();
    }

    [Test]
    public async Task Configured_menus_without_any_layer_are_not_an_empty_database()
    {
        await Page.RouteAsync("**/api/content-catalog", route =>
            route.FulfillAsync(new() { Status = 200, ContentType = "application/json", Body = "{\"layers\":[]}" }));
        await Map.GotoAsync();
        var panel = await Map.OpenLayerPanelAsync();

        Assert.That(await panel.SectionLabelsAsync(), Is.EqualTo(new[] { "Bostäder", "Trafik" }));
        var contentLayers = await Page.EvaluateAsync<int>("() => origo.api().getLayers().filter(l => l.get('contentLayer')).length");
        Assert.That(contentLayers, Is.EqualTo(0), "the old built-in layer list must not come back");
    }

    [Test]
    public async Task Catalog_layers_without_configured_menus_get_a_generated_menu()
    {
        await Page.RouteAsync("**/api/site-config", route =>
            route.FulfillAsync(new() { Status = 200, ContentType = "application/json", Body = "{\"headerText\":\"Testkarta\"}" }));
        await Map.GotoAsync();
        var panel = await Map.OpenLayerPanelAsync();

        Assert.That(await panel.SectionLabelsAsync(), Is.EqualTo(new[] { "Innehåll" }));
        var text = await Map.OpenLayerAsync("Innehåll", "Test Bostader Nulage");
        await Expect(text.Content.Locator("h1")).ToHaveTextAsync("Bostäder nuläge");
        Assert.That(await Map.IsLayerVisibleAsync("Test_Bostader_Nulage"), Is.True);
    }

    [Test]
    public async Task An_explicitly_emptied_menu_list_is_not_an_empty_database()
    {
        await Page.RouteAsync("**/api/site-config", route =>
            route.FulfillAsync(new() { Status = 200, ContentType = "application/json", Body = "{\"menus\":[]}" }));
        await Page.RouteAsync("**/api/content-catalog", route =>
            route.FulfillAsync(new() { Status = 200, ContentType = "application/json", Body = "{\"layers\":[]}" }));
        await Map.GotoAsync();
        var panel = await Map.OpenLayerPanelAsync();

        await Expect(panel.Sections).ToHaveCountAsync(0);
    }
}
