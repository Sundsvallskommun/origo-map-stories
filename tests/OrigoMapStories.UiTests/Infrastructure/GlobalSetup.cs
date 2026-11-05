using OrigoMapStories.UiTests.Infrastructure;

// One server and one database for the whole run, so tests must not run in parallel.
[assembly: Parallelizable(ParallelScope.None)]

/// <summary>Starts the content server and seeds the test database once per run (global namespace = whole assembly).</summary>
[SetUpFixture]
public class GlobalSetup
{
    [OneTimeSetUp]
    public async Task StartAsync()
    {
        // Fails fast (before anything is wiped) if TEST_DATABASE_URL is missing or not a *_test database.
        _ = TestSettings.NpgsqlConnectionString;

        TestServer.AssembleSite();
        TestServer.Main = await TestServer.StartAsync();
        await TestDatabase.SeedAsync();
    }

    [OneTimeTearDown]
    public void Stop() => TestServer.Main?.Dispose();
}
