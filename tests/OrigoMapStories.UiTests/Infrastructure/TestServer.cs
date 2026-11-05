using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;

namespace OrigoMapStories.UiTests.Infrastructure;

/// <summary>
/// The real Node content server serving an assembled site (Origo build +
/// this repo's public files and built plugin, same layout as on the Pi)
/// against the test database.
/// </summary>
public sealed class TestServer : IDisposable
{
    private readonly Process _process;
    private readonly StringBuilder _log;

    /// <summary>The server used by almost all tests (started once per run).</summary>
    public static TestServer Main { get; set; } = null!;

    public static string SiteDir => Path.Combine(AppContext.BaseDirectory, "site");

    public string BaseUrl { get; }

    /// <summary>Everything the server printed so far — attached to failing tests.</summary>
    public string Output { get { lock (_log) return _log.ToString(); } }

    private TestServer(Process process, StringBuilder log, string baseUrl)
    {
        _process = process;
        _log = log;
        BaseUrl = baseUrl;
    }

    /// <summary>Builds the site folder once per run. Throws with a hint when a build is missing.</summary>
    public static void AssembleSite()
    {
        var repo = TestSettings.RepoRoot;
        var origoBuild = Path.GetFullPath(Path.Combine(repo, "..", "origo", "build"));

        RequireFile(Path.Combine(origoBuild, "js", "origo.js"), "Build Origo once in ../origo (npm run build).");
        var js = Path.Combine(repo, "build", "js");
        var css = Path.Combine(repo, "build", "css");
        var editor = Path.Combine(repo, "build", "editor");
        RequireFile(Path.Combine(js, "origo-map-stories.min.js"), "Run 'npm run build' in the repository first.");
        RequireFile(Path.Combine(css, "origo-map-stories.min.css"), "Run 'npm run build' in the repository first.");
        RequireFile(Path.Combine(js, "structure-map-helper.min.js"), "Run 'npm run build' in the repository first.");
        RequireFile(Path.Combine(css, "structure-map-helper.css"), "Run 'npm run build' in the repository first.");
        RequireFile(Path.Combine(editor, "editor.js"), "Run 'npm run build-editor' in the repository first.");

        if (Directory.Exists(SiteDir)) Directory.Delete(SiteDir, recursive: true);
        CopyDirectory(origoBuild, SiteDir);

        foreach (var file in new[] { "index.html", "index.json", "legacy.html", "editor-config.json" })
            File.Copy(Path.Combine(TestSettings.FixturesDir, "site", file), Path.Combine(SiteDir, file), overwrite: true);

        // legacy.html registers the plugin under the old control key, so its
        // map config must list the control under that key too.
        var indexJson = File.ReadAllText(Path.Combine(SiteDir, "index.json"));
        const string controlKey = "\"name\": \"mapstories\"";
        if (!indexJson.Contains(controlKey)) throw new InvalidOperationException("Fixtures/site/index.json has no mapstories control.");
        File.WriteAllText(Path.Combine(SiteDir, "legacy.json"), indexJson.Replace(controlKey, "\"name\": \"structuremaphelper\""));
        File.Copy(Path.Combine(repo, "public", "editor.html"), Path.Combine(SiteDir, "editor.html"), overwrite: true);
        File.Copy(Path.Combine(editor, "editor.js"), Path.Combine(SiteDir, "editor.js"), overwrite: true);

        // The plugin under its new names plus the legacy byte-copies (scripts/copy-legacy-names.js).
        var plugins = Directory.CreateDirectory(Path.Combine(SiteDir, "plugins")).FullName;
        File.Copy(Path.Combine(js, "origo-map-stories.min.js"), Path.Combine(plugins, "origo-map-stories.js"), true);
        File.Copy(Path.Combine(css, "origo-map-stories.min.css"), Path.Combine(plugins, "origo-map-stories.css"), true);
        File.Copy(Path.Combine(js, "structure-map-helper.min.js"), Path.Combine(plugins, "structure-map-helper.js"), true);
        File.Copy(Path.Combine(css, "structure-map-helper.css"), Path.Combine(plugins, "structure-map-helper.css"), true);
        File.Copy(Path.Combine(repo, "public", "gor-sa-har.json"), Path.Combine(plugins, "gor-sa-har.json"), true);
        CopyDirectory(Path.Combine(repo, "public", "img"), Path.Combine(plugins, "img"));
    }

    /// <summary>
    /// Starts a server on a free port. <paramref name="publicBasePath"/> is the
    /// PUBLIC_BASE_PATH env (e.g. "/maps/stories" behind a reverse proxy).
    /// </summary>
    public static async Task<TestServer> StartAsync(string publicBasePath = "")
    {
        var port = FreePort();
        var log = new StringBuilder();
        var env = new Dictionary<string, string>
        {
            ["PORT"] = port.ToString(),
            ["DATABASE_URL"] = TestSettings.DatabaseUrl,
            ["PUBLIC_DIR"] = SiteDir,
            ["ADMIN_PASSWORD"] = TestSettings.AdminPassword,
            ["JWT_SECRET"] = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)),
            ["PUBLIC_BASE_PATH"] = publicBasePath,
            ["NODE_ENV"] = "test"
        };
        var process = NodeProcess.Start("content_server_node/server.js", [], env, log);
        var server = new TestServer(process, log, $"http://127.0.0.1:{port}");

        using var http = new HttpClient();
        var deadline = DateTime.UtcNow.AddSeconds(30);
        while (DateTime.UtcNow < deadline)
        {
            if (process.HasExited)
                throw new InvalidOperationException($"The content server exited during startup (code {process.ExitCode}).\n{server.Output}");
            try
            {
                var res = await http.GetAsync($"{server.BaseUrl}/api/content-catalog");
                if (res.StatusCode == HttpStatusCode.OK) return server;
            }
            catch (HttpRequestException)
            {
                // not listening yet
            }
            await Task.Delay(250);
        }
        server.Dispose();
        throw new TimeoutException($"The content server did not answer within 30 s.\n{server.Output}");
    }

    public void Dispose()
    {
        if (!_process.HasExited) _process.Kill(entireProcessTree: true);
        _process.Dispose();
    }

    private static void CopyDirectory(string source, string target)
    {
        Directory.CreateDirectory(target);
        foreach (var dir in Directory.GetDirectories(source, "*", SearchOption.AllDirectories))
            Directory.CreateDirectory(Path.Combine(target, Path.GetRelativePath(source, dir)));
        foreach (var file in Directory.GetFiles(source, "*", SearchOption.AllDirectories))
            File.Copy(file, Path.Combine(target, Path.GetRelativePath(source, file)), overwrite: true);
    }

    private static void RequireFile(string path, string hint)
    {
        if (!File.Exists(path)) throw new FileNotFoundException($"{path} is missing. {hint}");
    }

    public static int FreePort()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }
}
