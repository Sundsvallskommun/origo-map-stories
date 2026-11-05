using System.Text.RegularExpressions;
using OrigoMapStories.UiTests.Infrastructure;

namespace OrigoMapStories.UiTests.Tests;

/// <summary>
/// A host page written for StructureMapHelper keeps working after the rename
/// (Fixtures/site/legacy.html): the old file names
/// (plugins/structure-map-helper.js and .css), the global StructureMapHelper,
/// the control key "structuremaphelper", window.STRUCTURE_MAP_HELPER_API_BASE
/// and the old DOM ids and classes. The names live in src/compat.js.
/// </summary>
public class LegacyCompatibilityTests : UiTestBase
{
    private const string LegacyApi = "/legacy-api";
    private readonly List<string> _legacyApiRequests = [];

    /// <summary>The page's API global points at /legacy-api; forward it to the content server.</summary>
    [SetUp]
    public async Task RouteLegacyApiAsync()
    {
        await Context.RouteAsync($"**{LegacyApi}/**", async route =>
        {
            lock (_legacyApiRequests) _legacyApiRequests.Add(route.Request.Url);
            var response = await route.FetchAsync(new() { Url = route.Request.Url.Replace(LegacyApi, "") });
            await route.FulfillAsync(new() { Response = response });
        });
    }

    private List<string> LegacyApiRequests() { lock (_legacyApiRequests) return [.. _legacyApiRequests]; }

    private async Task GotoLegacyAsync(bool admin = false)
    {
        await Page.GotoAsync(admin ? "/legacy.html?admin" : "/legacy.html");
        await Expect(Map.PluginButton).ToBeVisibleAsync();
        await Expect(Page.Locator("#o-rvn-logo-corner")).ToBeAttachedAsync();
    }

    [Test]
    public async Task Legacy_globals_and_dom_names_are_still_there()
    {
        await GotoLegacyAsync();

        Assert.That(await Page.EvaluateAsync<bool>("() => window.StructureMapHelper === window.OrigoMapStories"), Is.True);
        Assert.That(await Page.EvaluateAsync<string>("() => window.StructureMapHelperBuild"), Is.Not.Empty);

        await Expect(Page.Locator("button.o-structuremaphelper.o-mapstories")).ToHaveCountAsync(1);
        await Expect(Page.Locator("img#o-btn-rvn-logo-img.o-btn-rvn-logo.o-mapstories-button-icon")).ToHaveCountAsync(1);
        await Expect(Page.Locator("img#o-rvn-logo-corner.o-rvn-logo-corner.o-mapstories-corner-logo")).ToHaveCountAsync(1);

        // The stylesheet under its old name is applied.
        Assert.That(await Page.Locator("#o-rvn-logo-corner").EvaluateAsync<string>("img => getComputedStyle(img).position"),
            Is.EqualTo("absolute"));
        AssertNoJsErrors();
    }

    [Test]
    public async Task Panel_opens_and_content_comes_through_the_legacy_api_global()
    {
        await GotoLegacyAsync();
        var text = await Map.OpenLayerAsync("Bostäder", "Nuläge");

        await Expect(text.Content.Locator("h1")).ToHaveTextAsync("Bostäder nuläge");
        await WaitForValueAsync(() => Map.LoadedFeatureCountAsync("Test_Bostader_Nulage"), 2, "overlay loaded through the legacy API base");
        var requests = LegacyApiRequests();
        Assert.That(requests, Has.Some.Contains($"{LegacyApi}/api/site-config"));
        Assert.That(requests, Has.Some.Contains($"{LegacyApi}/api/content/Test_Bostader_Nulage"));
        Assert.That(requests, Has.Some.Contains($"{LegacyApi}/content-files/Test_Bostader_Nulage.geojson"));
    }

    [Test]
    public async Task Map_editor_gets_the_legacy_api_base_passed_on()
    {
        await GotoLegacyAsync(admin: true);
        await Map.Login.LoginAsync(TestSettings.AdminPassword);
        var text = await Map.OpenLayerAsync("Bostäder", "Nuläge");
        await text.MapEditorButton.ClickAsync();

        await Expect(Map.MapEditor.Modal.Locator("iframe")).ToHaveAttributeAsync("src",
            new Regex(@"/editor\.html\?layer=Test_Bostader_Nulage&apiBase=[^&]*%2Flegacy-api$"));
        await Map.MapEditor.WaitForLoadedAsync();
        await Expect(Map.MapEditor.Status).ToHaveTextAsync("2 objekt laddade");
        await Map.MapEditor.AddPointAsync("node-main", 200, 200);
        await Map.MapEditor.SaveAsync();

        Assert.That(await TestDatabase.FeatureCountAsync("Test_Bostader_Nulage"), Is.EqualTo(3));
        Assert.That(LegacyApiRequests(), Has.Some.Contains($"{LegacyApi}/api/geojson/Test_Bostader_Nulage"));
    }
}
