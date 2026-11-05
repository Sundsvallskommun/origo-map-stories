using System.Text.Json.Nodes;
using OrigoMapStories.UiTests.Infrastructure;
using OrigoMapStories.UiTests.Pages;

namespace OrigoMapStories.UiTests.Tests;

/// <summary>
/// The plugin option "apiBase": "/" means the origin root, not "unset": a map
/// page in a subfolder (/sub/folder/) with the content API at the origin root
/// (/api/...) calls the API at the root. The subfolder is served by request
/// routing from the site root, with the option added to index.json; any API
/// or content-file request under the subfolder answers 404 and is recorded.
/// </summary>
public class ApiBaseRootTests : UiTestBase
{
    private const string Folder = "/sub/folder";
    private readonly List<string> _folderRequests = [];
    private readonly List<string> _requests = [];

    protected override MapPage CreateMapPage(IPage page) => new(page, $"{TestServer.Main.BaseUrl}{Folder}");

    [SetUp]
    public async Task ServeSubfolderAsync()
    {
        Page.Request += (_, request) => { lock (_requests) _requests.Add(request.Url); };
        await Context.RouteAsync($"**{Folder}/**", async route =>
        {
            var url = new Uri(route.Request.Url);
            var path = url.AbsolutePath[Folder.Length..];
            if (path.StartsWith("/api/") || path.StartsWith("/content-files/"))
            {
                lock (_folderRequests) _folderRequests.Add(url.PathAndQuery);
                await route.FulfillAsync(new() { Status = 404 });
                return;
            }
            var rootUrl = $"{url.GetLeftPart(UriPartial.Authority)}{path}{url.Query}";
            var response = await route.FetchAsync(new() { Url = rootUrl });
            if (path != "/index.json")
            {
                await route.FulfillAsync(new() { Response = response });
                return;
            }
            var json = JsonNode.Parse(await response.TextAsync())!;
            var control = json["controls"]!.AsArray().First(c => (string?)c!["name"] == "mapstories")!;
            control["options"]!["apiBase"] = "/";
            await route.FulfillAsync(new() { Response = response, Body = json.ToJsonString() });
        });
    }

    private List<string> FolderRequests() { lock (_folderRequests) return [.. _folderRequests]; }
    private List<string> Requests() { lock (_requests) return [.. _requests]; }

    [Test]
    public async Task Api_base_slash_in_a_subfolder_calls_the_api_at_the_origin_root()
    {
        await Map.GotoAsync();
        Assert.That(new Uri(Page.Url).AbsolutePath, Is.EqualTo($"{Folder}/"));
        var text = await Map.OpenLayerAsync("Bostäder", "Nuläge");

        await Expect(text.Content.Locator("h1")).ToHaveTextAsync("Bostäder nuläge");
        await WaitForValueAsync(() => Map.LoadedFeatureCountAsync("Test_Bostader_Nulage"), 2, "overlay loaded from the origin root");
        var origin = TestServer.Main.BaseUrl.TrimEnd('/');
        var requests = Requests();
        Assert.That(requests, Has.Some.StartWith($"{origin}/api/site-config"));
        Assert.That(requests, Has.Some.StartWith($"{origin}/api/content/Test_Bostader_Nulage"));
        Assert.That(FolderRequests(), Is.Empty);
    }
}
