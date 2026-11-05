using System.Xml.Linq;
using Npgsql;

namespace OrigoMapStories.UiTests.Infrastructure;

/// <summary>Paths and configuration shared by the whole test run.</summary>
public static class TestSettings
{
    public const string AdminPassword = "ui-test-password";

    /// <summary>The repository root (the folder with package.json and content_server_node/).</summary>
    public static string RepoRoot { get; } = FindRepoRoot();

    public static string FixturesDir => Path.Combine(AppContext.BaseDirectory, "Fixtures");
    public static string FixtureContentDir => Path.Combine(FixturesDir, "content");
    public static string UploadsDir => Path.Combine(FixturesDir, "uploads");

    /// <summary>
    /// postgres:// URL of the test database. Must point at a database whose
    /// name ends with "_test" — every test wipes it.
    /// </summary>
    public static string DatabaseUrl
    {
        get
        {
            var url = Environment.GetEnvironmentVariable("TEST_DATABASE_URL");
            if (string.IsNullOrWhiteSpace(url)) url = ReadFromRunSettings("TEST_DATABASE_URL");
            if (string.IsNullOrWhiteSpace(url))
            {
                throw new InvalidOperationException(
                    "TEST_DATABASE_URL is not set. Set it as an environment variable or in tests/OrigoMapStories.UiTests/.runsettings " +
                    "(see .runsettings.example), e.g. postgres://USER:PASSWORD@db.example.test:5432/origo_map_stories_test");
            }
            return url.Trim();
        }
    }

    /// <summary>Npgsql connection string built from <see cref="DatabaseUrl"/>, after the safety check.</summary>
    public static string NpgsqlConnectionString
    {
        get
        {
            var uri = new Uri(DatabaseUrl);
            if (uri.Scheme is not ("postgres" or "postgresql"))
                throw new InvalidOperationException($"TEST_DATABASE_URL must be a postgres:// URL, got scheme '{uri.Scheme}'.");

            var database = Uri.UnescapeDataString(uri.AbsolutePath.TrimStart('/'));
            if (!database.EndsWith("_test", StringComparison.Ordinal))
            {
                throw new InvalidOperationException(
                    $"Refusing to run: the test database '{database}' does not end with '_test'. " +
                    "The UI tests wipe their database before every test.");
            }

            var userInfo = uri.UserInfo.Split(':', 2);
            return new NpgsqlConnectionStringBuilder
            {
                Host = uri.Host,
                Port = uri.Port > 0 ? uri.Port : 5432,
                Database = database,
                Username = Uri.UnescapeDataString(userInfo[0]),
                Password = userInfo.Length > 1 ? Uri.UnescapeDataString(userInfo[1]) : null
            }.ConnectionString;
        }
    }

    /// <summary>
    /// Fallback for runners that don't apply the project's .runsettings (e.g.
    /// VS Code's Test Explorer): read the environment variable straight from
    /// tests/OrigoMapStories.UiTests/.runsettings.
    /// </summary>
    private static string? ReadFromRunSettings(string name)
    {
        var file = Path.Combine(RepoRoot, "tests", "OrigoMapStories.UiTests", ".runsettings");
        if (!File.Exists(file)) return null;
        var value = XDocument.Load(file)
            .Descendants("EnvironmentVariables").Elements(name).FirstOrDefault()?.Value;
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }

    private static string FindRepoRoot()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir != null; dir = dir.Parent)
        {
            if (File.Exists(Path.Combine(dir.FullName, "package.json")) &&
                Directory.Exists(Path.Combine(dir.FullName, "content_server_node")))
            {
                return dir.FullName;
            }
        }
        throw new InvalidOperationException($"Could not find the repository root above {AppContext.BaseDirectory}.");
    }
}
