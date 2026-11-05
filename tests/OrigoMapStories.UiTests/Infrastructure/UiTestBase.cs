using System.Text.Json;
using NUnit.Framework.Interfaces;
using OrigoMapStories.UiTests.Pages;

namespace OrigoMapStories.UiTests.Infrastructure;

/// <summary>
/// Base class for all UI tests: resets the database, points the browser at
/// the test server, blocks all non-local network traffic, collects JS errors
/// and keeps a Playwright trace of failing tests.
/// </summary>
public abstract class UiTestBase : PageTest
{
    /// <summary>Uncaught page errors and console errors seen during the test.</summary>
    protected List<string> JsErrors { get; } = [];

    protected MapPage Map => CreateMapPage(Page);

    /// <summary>Overridden by tests that run the app under another URL (e.g. /maps/stories).</summary>
    protected virtual MapPage CreateMapPage(IPage page) => new(page);

    public override BrowserNewContextOptions ContextOptions() => new()
    {
        BaseURL = TestServer.Main.BaseUrl,
        ViewportSize = new ViewportSize { Width = 1400, Height = 900 },
        Locale = "sv-SE",
        AcceptDownloads = true,
        // Keep the tests off the internet (background maps, the example WFS):
        // everything except localhost goes to a proxy that does not exist and
        // fails at once. A proxy instead of request interception, because
        // interception breaks blob: images in Playwright's WebKit.
        Proxy = new Proxy { Server = "http://127.0.0.1:9", Bypass = "127.0.0.1,localhost" }
    };

    [SetUp]
    public async Task UiTestSetUpAsync()
    {
        await TestDatabase.ResetAsync();
        await PrepareContextAsync(Context, JsErrors);
        await Context.Tracing.StartAsync(new() { Screenshots = true, Snapshots = true, Sources = true });
    }

    [TearDown]
    public async Task UiTestTearDownAsync()
    {
        var failed = TestContext.CurrentContext.Result.Outcome.Status == TestStatus.Failed;
        var tracePath = failed
            ? Path.Combine(TestContext.CurrentContext.WorkDirectory, "playwright-traces",
                $"{TestContext.CurrentContext.Test.ClassName}.{TestContext.CurrentContext.Test.MethodName}.zip")
            : null;
        await Context.Tracing.StopAsync(new() { Path = tracePath });
        if (tracePath != null)
        {
            TestContext.AddTestAttachment(tracePath, "Playwright trace (open with: playwright.ps1 show-trace <file>)");
            TestContext.Out.WriteLine($"Server output:\n{TestServer.Main.Output}");
        }
    }

    /// <summary>Records JS errors for a context (external requests are blocked by the proxy in ContextOptions).</summary>
    protected static Task PrepareContextAsync(IBrowserContext context, List<string> errors)
    {
        foreach (var page in context.Pages) RecordErrors(page, errors);
        context.Page += (_, page) => RecordErrors(page, errors);
        return Task.CompletedTask;
    }

    // How the browsers report requests that failed because external traffic is blocked.
    private static readonly string[] BlockedRequestMessages =
    [
        "net::ERR_", "Failed to load resource", "CORS request did not succeed", "Could not connect to", "proxy"
    ];

    private static bool IsBlockedRequestMessage(string text) =>
        BlockedRequestMessages.Any(m => text.Contains(m, StringComparison.OrdinalIgnoreCase));

    private static void RecordErrors(IPage page, List<string> errors)
    {
        page.PageError += (_, message) => { lock (errors) errors.Add($"pageerror: {message}"); };
        page.Console += (_, msg) =>
        {
            // Blocked external requests show up as console errors; they are expected.
            if (msg.Type == "error" && !IsBlockedRequestMessage(msg.Text))
                lock (errors) errors.Add($"console: {msg.Text}");
        };
    }

    /// <summary>A second, independent browser session (e.g. another admin) with the same setup.</summary>
    protected async Task<(IBrowserContext Context, IPage Page)> NewSessionAsync()
    {
        var context = await Browser.NewContextAsync(ContextOptions());
        await PrepareContextAsync(context, JsErrors);
        return (context, await context.NewPageAsync());
    }

    // ─── Admin helpers ───────────────────────────────────────────────────────

    /// <summary>Opens the admin link and logs in through the login modal.</summary>
    protected async Task<MapPage> OpenAsAdminAsync(IPage? page = null)
    {
        var map = CreateMapPage(page ?? Page);
        await map.GotoAsync(admin: true);
        await map.Login.LoginAsync(TestSettings.AdminPassword);
        return map;
    }

    /// <summary>A fresh admin JWT obtained directly from the API.</summary>
    protected async Task<string> GetAdminTokenAsync()
    {
        var res = await Page.APIRequest.PostAsync("/api/auth", new() { DataObject = new { password = TestSettings.AdminPassword } });
        Assert.That(res.Ok, Is.True, "admin login via API failed");
        return (await res.JsonAsync())!.Value.GetProperty("token").GetString()!;
    }

    protected async Task<JsonElement> ApiGetJsonAsync(string path, string? token = null)
    {
        var headers = new Dictionary<string, string>();
        if (token != null) headers["Authorization"] = $"Bearer {token}";
        var res = await Page.APIRequest.GetAsync(path, new() { Headers = headers });
        Assert.That(res.Ok, Is.True, $"GET {path} returned {res.Status}");
        return (await res.JsonAsync())!.Value;
    }

    protected async Task<List<JsonElement>> ListVersionsAsync()
    {
        var json = await ApiGetJsonAsync("/api/versions", await GetAdminTokenAsync());
        return json.GetProperty("versions").EnumerateArray().ToList();
    }

    /// <summary>Polls until the value equals <paramref name="expected"/> (Playwright for .NET has no Expect.Poll).</summary>
    protected static async Task WaitForValueAsync<T>(Func<Task<T>> read, T expected, string what, int timeoutMs = 10000)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        T actual = await read();
        while (!EqualityComparer<T>.Default.Equals(actual, expected) && DateTime.UtcNow < deadline)
        {
            await Task.Delay(200);
            actual = await read();
        }
        Assert.That(actual, Is.EqualTo(expected), what);
    }

    protected void AssertNoJsErrors()
    {
        lock (JsErrors) Assert.That(JsErrors, Is.Empty, "JavaScript errors on the page");
    }
}
