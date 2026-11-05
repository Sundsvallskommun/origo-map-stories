using System.Text;
using System.Text.RegularExpressions;
using OrigoMapStories.UiTests.Infrastructure;
using OrigoMapStories.UiTests.Pages;

namespace OrigoMapStories.UiTests.Tests;

/// <summary>
/// The app served under a path prefix behind a reverse proxy, which strips the
/// prefix before passing requests on to the content server
/// (PUBLIC_BASE_PATH=/maps/stories). Infrastructure/base-path-proxy.js plays
/// the proxy; any request outside the prefix gets 404 and is logged, so a
/// missing prefix shows. The plugin finds the prefix from the page's folder.
/// </summary>
public class BasePathTests : UiTestBase
{
    private const string Prefix = "/maps/stories";

    private static TestServer _server = null!;
    private static System.Diagnostics.Process _proxy = null!;
    private static readonly StringBuilder ProxyLog = new();
    private static string _appUrl = "";
    private int _logStart;

    [OneTimeSetUp]
    public async Task StartServerAndProxyAsync()
    {
        _server = await TestServer.StartAsync(publicBasePath: Prefix);
        var port = TestServer.FreePort();
        _proxy = NodeProcess.Start("tests/OrigoMapStories.UiTests/Infrastructure/base-path-proxy.js",
            [port.ToString(), _server.BaseUrl, Prefix], new Dictionary<string, string>(), ProxyLog);
        for (var i = 0; i < 100 && !ProxyText().Contains("LISTENING"); i++) await Task.Delay(100);
        Assert.That(ProxyText(), Does.Contain("LISTENING"), $"proxy did not start: {ProxyText()}");
        _appUrl = $"http://127.0.0.1:{port}{Prefix}";
    }

    [OneTimeTearDown]
    public void StopServerAndProxy()
    {
        if (_proxy is { HasExited: false }) _proxy.Kill(entireProcessTree: true);
        _proxy?.Dispose();
        _server?.Dispose();
    }

    private static string ProxyText() { lock (ProxyLog) return ProxyLog.ToString(); }

    protected override MapPage CreateMapPage(IPage page) => new(page, _appUrl);

    /// <summary>
    /// The fixture content has root-relative URLs (/content-files/…). Content
    /// created under a prefix carries the prefix, so rewrite the fixture's
    /// site-config and text image URLs the same way before each test.
    /// </summary>
    [SetUp]
    public async Task PrefixFixtureUrlsAsync()
    {
        var token = await GetAdminTokenAsync();
        var auth = new Dictionary<string, string> { ["Authorization"] = $"Bearer {token}" };
        foreach (var (get, write, method) in new[]
        {
            ("/api/site-config", "/api/site-config", "PUT"),
            ("/api/content/Test_Bostader_Nulage", "/api/content/Test_Bostader_Nulage", "POST")
        })
        {
            var json = (await ApiGetJsonAsync(get)).GetRawText().Replace("\"/content-files/", $"\"{Prefix}/content-files/");
            var res = await Page.APIRequest.FetchAsync(write, new()
            {
                Method = method,
                Headers = new Dictionary<string, string>(auth) { ["Content-Type"] = "application/json" },
                Data = json
            });
            Assert.That(res.Ok, Is.True, $"{method} {write} failed: {res.Status}");
        }
    }

    [SetUp]
    public void MarkProxyLog() => _logStart = ProxyText().Length;

    /// <summary>Plugin requests (API, content files, editor) that missed the prefix in this test.</summary>
    private List<string> MissedPluginRequests() =>
        ProxyText()[_logStart..].Split('\n')
            .Where(l => l.StartsWith("OUTSIDE "))
            .Select(l => l["OUTSIDE ".Length..].Trim())
            .Where(p => p.StartsWith("/api/") || p.StartsWith("/content-files/") || p.StartsWith("/editor"))
            .ToList();

    [Test]
    public async Task App_loads_and_uses_the_prefix_for_all_plugin_requests()
    {
        await Map.GotoAsync();
        var text = await Map.OpenLayerAsync("Bostäder", "Nuläge");

        await Expect(text.Content.Locator("h1")).ToHaveTextAsync("Bostäder nuläge");
        await WaitForValueAsync(() => Map.LoadedFeatureCountAsync("Test_Bostader_Nulage"), 2, "overlay loaded through the prefix");
        Assert.That(MissedPluginRequests(), Is.Empty);
    }

    [Test]
    public async Task Prefix_without_a_trailing_slash_is_the_app_folder()
    {
        await Map.GotoAsync();
        await Map.OpenLayerPanelAsync();
        // A proxy redirects /maps/stories to /maps/stories/ before the page
        // loads, so move the URL afterwards: every plugin request from here on
        // resolves its base from a page URL without the trailing slash.
        await Page.EvaluateAsync("prefix => history.replaceState(null, '', prefix)", Prefix);
        var text = await Map.OpenLayerAsync("Bostäder", "Nuläge");

        await Expect(text.Content.Locator("h1")).ToHaveTextAsync("Bostäder nuläge");
        Assert.That(new Uri(Page.Url).AbsolutePath, Is.EqualTo(Prefix));
        Assert.That(MissedPluginRequests(), Is.Empty);
    }

    [Test]
    public async Task App_loaded_as_index_html_uses_the_prefix()
    {
        await Page.GotoAsync($"{_appUrl}/index.html?admin");
        await Map.Login.LoginAsync(TestSettings.AdminPassword);
        var text = await Map.OpenLayerAsync("Bostäder", "Nuläge");

        await Expect(text.Content.Locator("h1")).ToHaveTextAsync("Bostäder nuläge");
        await WaitForValueAsync(() => Map.LoadedFeatureCountAsync("Test_Bostader_Nulage"), 2, "overlay loaded through the prefix");
        await text.MapEditorButton.ClickAsync();
        await Expect(Map.MapEditor.Modal.Locator("iframe")).ToHaveAttributeAsync("src", new Regex(@"/maps/stories/editor\.html\?layer=Test_Bostader_Nulage$"));
        await Map.MapEditor.WaitForLoadedAsync();
        await Expect(Map.MapEditor.Status).ToHaveTextAsync("2 objekt laddade");
        Assert.That(MissedPluginRequests(), Is.Empty);
    }

    [Test]
    public async Task Admin_login_and_text_save_work_under_the_prefix()
    {
        var map = await OpenAsAdminAsync();
        var text = await map.OpenLayerAsync("Trafik", "Kollektivtrafik");
        await text.StartEditingAsync();
        await text.AppendParagraphAsync("Sparat via basvägen");
        await text.SaveAsync();

        var saved = (await ApiGetJsonAsync("/api/content/Test_Kollektivtrafik")).GetRawText();
        Assert.That(saved, Does.Contain("Sparat via basvägen"));
        Assert.That(MissedPluginRequests(), Is.Empty);
    }

    [Test]
    public async Task Uploaded_text_image_gets_a_prefixed_url_that_loads()
    {
        var map = await OpenAsAdminAsync();
        var text = await map.OpenLayerAsync("Trafik", "Kollektivtrafik");
        await text.StartEditingAsync();
        await text.MoveCursorToEndAsync();
        await text.InsertImageAsync(Path.Combine(TestSettings.UploadsDir, "text-image.png"));

        var image = text.Images.Last;
        await Expect(image).ToHaveAttributeAsync("src", new Regex(@"^/maps/stories/content-files/images/\d+-text_image\.png$"));
        await WaitForValueAsync(() => image.EvaluateAsync<bool>("img => img.complete && img.naturalWidth === 80"), true, "image loads");
        await text.SaveAsync();
        Assert.That(MissedPluginRequests(), Is.Empty);
    }

    [Test]
    public async Task Uploaded_site_asset_gets_a_prefixed_url_that_loads()
    {
        var map = await OpenAsAdminAsync();
        await map.SiteConfig.OpenAsync(await map.OpenLayerPanelAsync());
        await map.SiteConfig.SelectTabAsync("profil");

        await map.SiteConfig.UploadAssetAsync("button-icon", Path.Combine(TestSettings.UploadsDir, "icon-valid.png"));

        var thumb = map.SiteConfig.AssetThumb("button-icon");
        await Expect(thumb).ToHaveAttributeAsync("src", new Regex(@"^/maps/stories/content-files/site-assets/button-icon\.png\?v=\d+$"));
        await WaitForValueAsync(() => thumb.EvaluateAsync<bool>("img => img.complete && img.naturalWidth === 38"), true, "icon loads");
        await map.SiteConfig.SaveAsync();
        Assert.That(MissedPluginRequests(), Is.Empty);
    }

    [Test]
    public async Task Map_editor_opens_and_saves_under_the_prefix()
    {
        var map = await OpenAsAdminAsync();
        var text = await map.OpenLayerAsync("Bostäder", "Nuläge");
        await text.MapEditorButton.ClickAsync();

        await Expect(map.MapEditor.Modal.Locator("iframe")).ToHaveAttributeAsync("src", new Regex(@"/maps/stories/editor\.html\?layer=Test_Bostader_Nulage$"));
        await map.MapEditor.WaitForLoadedAsync();
        await Expect(map.MapEditor.Status).ToHaveTextAsync("2 objekt laddade");
        await map.MapEditor.AddPointAsync("node-main", 200, 200);
        await map.MapEditor.SaveAsync();

        Assert.That(await TestDatabase.FeatureCountAsync("Test_Bostader_Nulage"), Is.EqualTo(3));
        Assert.That(MissedPluginRequests(), Is.Empty);
    }

    [Test]
    public async Task Version_export_works_under_the_prefix()
    {
        var map = await OpenAsAdminAsync();
        await map.SiteConfig.OpenAsync(await map.OpenLayerPanelAsync());
        await map.SiteConfig.SelectTabAsync("versioner");
        await Expect(map.SiteConfig.Versions.CurrentRow).ToBeVisibleAsync();

        var download = await map.SiteConfig.Versions.ExportAsync(map.SiteConfig.Versions.ExportCurrentButton);

        Assert.That(download.SuggestedFilename, Does.Match(@"^origo-map-stories_v\d+_.*\.zip$"));
        Assert.That(new FileInfo(await download.PathAsync()).Length, Is.GreaterThan(1000));
        Assert.That(MissedPluginRequests(), Is.Empty);
    }
}
