using System.Text.Json;
using OrigoMapStories.UiTests.Infrastructure;

namespace OrigoMapStories.UiTests.Tests;

/// <summary>
/// The map editor page (editor.html) on its own: its background and start
/// view come from editor-config.json (Fixtures/site/editor-config.json), and
/// URL parameters that point elsewhere (?apiBase=, ?config=) are only accepted
/// from the editor's own origin, so a link can't send the admin token away.
/// </summary>
public class EditorConfigTests : UiTestBase
{
    // Fixtures/site/editor-config.json
    private static readonly double[] FixtureCenter = [594242, 6940514];
    private const double FixtureResolution = 140;
    private const string FixtureWms = "http://wms.example.test/";

    private readonly List<string> _requests = [];

    [SetUp]
    public void RecordRequests()
    {
        lock (_requests) _requests.Clear();
        Page.Request += (_, request) => { lock (_requests) _requests.Add(request.Url); };
    }

    private List<string> Requests() { lock (_requests) return [.. _requests]; }

    private ILocator Status => Page.Locator("#ed-status");

    private async Task GotoEditorAsync(string query)
    {
        await Page.GotoAsync($"/editor.html?{query}");
        await Expect(Status).ToHaveTextAsync(new System.Text.RegularExpressions.Regex("objekt laddade|Nytt lager"));
    }

    /// <summary>[x, y, resolution] of the editor view.</summary>
    private Task<double[]> ViewAsync() =>
        Page.EvaluateAsync<double[]>(
            @"() => {
                const view = window.mapStoriesEditor.map.getView();
                return [...view.getCenter(), view.getResolution()];
            }");

    private Task<string> ApiBaseAsync() => Page.EvaluateAsync<string>("() => window.mapStoriesEditor.apiBase");

    [Test]
    public async Task Editor_config_sets_the_background_and_the_start_view()
    {
        await Page.RouteAsync($"{FixtureWms}**", route => route.AbortAsync());
        await GotoEditorAsync("layer=Ny_testlayer");

        var view = await ViewAsync();
        Assert.That(view[0], Is.EqualTo(FixtureCenter[0]).Within(1e-6));
        Assert.That(view[1], Is.EqualTo(FixtureCenter[1]).Within(1e-6));
        Assert.That(view[2], Is.EqualTo(FixtureResolution).Within(1e-6), "zoom 1 of the configured tile grid");
        await WaitForValueAsync(() => Task.FromResult(Requests().Any(u => u.StartsWith(FixtureWms) && u.Contains("example%3Abakgrund"))),
            true, "background tiles are requested from the configured WMS");
    }

    [Test]
    public async Task Without_an_editor_config_the_background_is_openstreetmap_over_sweden()
    {
        await Page.RouteAsync("**/editor-config.json", route => route.FulfillAsync(new() { Status = 404 }));
        await GotoEditorAsync("layer=Ny_testlayer");

        var view = await ViewAsync();
        Assert.That(view[0], Is.EqualTo(600000).Within(1e-6));
        Assert.That(view[1], Is.EqualTo(6900000).Within(1e-6));
        var urls = await Page.EvaluateAsync<string[]>(
            "() => window.mapStoriesEditor.map.getLayers().getArray()[0].getSource().getUrls() || []");
        Assert.That(urls, Has.Some.Contains("tile.openstreetmap.org"));
        Assert.That(Requests(), Has.None.StartWith(FixtureWms));
    }

    [Test]
    public async Task A_same_origin_config_parameter_replaces_the_editor_config()
    {
        var config = JsonSerializer.Serialize(new { background = new { type = "none" }, center = new[] { 700000, 7000000 }, zoom = 3 });
        await Page.RouteAsync("**/annan-editor-config.json", route =>
            route.FulfillAsync(new() { Status = 200, ContentType = "application/json", Body = config }));
        await GotoEditorAsync("layer=Ny_testlayer&config=annan-editor-config.json");

        var view = await ViewAsync();
        Assert.That(view[0], Is.EqualTo(700000).Within(1e-6));
        Assert.That(view[1], Is.EqualTo(7000000).Within(1e-6));
        Assert.That(view[2], Is.EqualTo(512).Within(1e-6), "zoom 3 of the default grid (4096 m/px halved per level)");
        Assert.That(await Page.EvaluateAsync<int>("() => window.mapStoriesEditor.map.getLayers().getLength()"), Is.EqualTo(1),
            "background \"none\": only the editable layer");
    }

    [Test]
    public async Task A_config_parameter_from_another_origin_is_ignored()
    {
        await GotoEditorAsync("layer=Ny_testlayer&config=http://evil.example.test/editor-config.json");

        var view = await ViewAsync();
        Assert.That(view[0], Is.EqualTo(FixtureCenter[0]).Within(1e-6));
        Assert.That(Requests().Select(u => new Uri(u).Host), Has.None.EqualTo("evil.example.test"), "no request to the other origin");
    }

    [Test]
    public async Task An_api_base_from_another_origin_is_ignored()
    {
        await GotoEditorAsync("layer=Test_Bostader_Nulage&apiBase=http://evil.example.test/api-host");

        await Expect(Status).ToHaveTextAsync("2 objekt laddade");
        Assert.That(await ApiBaseAsync(), Is.EqualTo(TestServer.Main.BaseUrl));
        Assert.That(Requests().Select(u => new Uri(u).Host), Has.None.EqualTo("evil.example.test"), "no request to the other origin");
    }

    [Test]
    public async Task A_same_origin_api_base_is_used()
    {
        await Page.RouteAsync("**/annan-bas/**", async route =>
        {
            var response = await route.FetchAsync(new() { Url = route.Request.Url.Replace("/annan-bas", "") });
            await route.FulfillAsync(new() { Response = response });
        });
        await GotoEditorAsync($"layer=Test_Bostader_Nulage&apiBase={Uri.EscapeDataString(TestServer.Main.BaseUrl + "/annan-bas/")}");

        await Expect(Status).ToHaveTextAsync("2 objekt laddade");
        Assert.That(await ApiBaseAsync(), Is.EqualTo($"{TestServer.Main.BaseUrl}/annan-bas"));
        Assert.That(Requests(), Has.Some.Contains("/annan-bas/content-files/Test_Bostader_Nulage.geojson"));
    }
}
