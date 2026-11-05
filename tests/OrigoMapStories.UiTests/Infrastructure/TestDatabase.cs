using Npgsql;

namespace OrigoMapStories.UiTests.Infrastructure;

/// <summary>
/// Resets the test database to the fixture content before every test.
///
/// The fixture folder is imported once with the real import script
/// (scripts/import-content-folder.js); the resulting rows are kept in memory
/// and written back before each test, so every test starts from version 1
/// without spawning node again.
/// </summary>
public static class TestDatabase
{
    private const string Tables = "version, version_file, blob, current_version, pending_upload, current_feature";

    private static Snapshot? _snapshot;

    private sealed record Snapshot(
        List<object?[]> Blobs,
        List<object?[]> Versions,
        List<object?[]> VersionFiles,
        List<object?[]> CurrentVersion,
        List<object?[]> Features);

    public static async Task<NpgsqlConnection> OpenAsync()
    {
        var conn = new NpgsqlConnection(TestSettings.NpgsqlConnectionString);
        await conn.OpenAsync();
        return conn;
    }

    /// <summary>Imports the fixture content once and snapshots it. Requires the server to have run its migrations.</summary>
    public static async Task SeedAsync()
    {
        await using (var conn = await OpenAsync())
            await Exec(conn, $"TRUNCATE {Tables} RESTART IDENTITY CASCADE");

        await NodeProcess.RunAsync(
            "scripts/import-content-folder.js",
            [TestSettings.FixtureContentDir, "--force"],
            new Dictionary<string, string> { ["DATABASE_URL"] = TestSettings.DatabaseUrl },
            TimeSpan.FromSeconds(60));

        await using var c = await OpenAsync();
        _snapshot = new Snapshot(
            await ReadRows(c, "SELECT sha256, content, mime, size, created_at FROM blob"),
            await ReadRows(c, "SELECT id, created_at, kind, description, source_version FROM version"),
            await ReadRows(c, "SELECT version_id, path, sha256 FROM version_file"),
            await ReadRows(c, "SELECT id, version_id FROM current_version"),
            await ReadRows(c, "SELECT layer_name, feature_index, properties::text, ST_AsEWKB(geom) FROM current_feature"));
    }

    /// <summary>Puts the database back to exactly the seeded state (version 1 current).</summary>
    public static async Task ResetAsync()
    {
        var s = _snapshot ?? throw new InvalidOperationException("SeedAsync has not run.");
        await using var conn = await OpenAsync();
        await using var tx = await conn.BeginTransactionAsync();

        await Exec(conn, $"TRUNCATE {Tables} RESTART IDENTITY CASCADE");
        await Insert(conn, "INSERT INTO blob (sha256, content, mime, size, created_at) VALUES ($1, $2, $3, $4, $5)", s.Blobs);
        await Insert(conn, "INSERT INTO version (id, created_at, kind, description, source_version) VALUES ($1, $2, $3, $4, $5)", s.Versions);
        await Insert(conn, "INSERT INTO version_file (version_id, path, sha256) VALUES ($1, $2, $3)", s.VersionFiles);
        await Insert(conn, "INSERT INTO current_version (id, version_id) VALUES ($1, $2)", s.CurrentVersion);
        await Insert(conn, "INSERT INTO current_feature (layer_name, feature_index, properties, geom) VALUES ($1, $2, $3::jsonb, ST_GeomFromEWKB($4))", s.Features);
        await Exec(conn, "SELECT setval(pg_get_serial_sequence('version', 'id'), COALESCE((SELECT max(id) FROM version), 0) + 1, false)");

        await tx.CommitAsync();
    }

    // ─── Assertions helpers ──────────────────────────────────────────────────

    public static Task<long> CountAsync(string sql) => ScalarAsync<long>(sql);

    public static async Task<T> ScalarAsync<T>(string sql, params object[] args)
    {
        await using var conn = await OpenAsync();
        await using var cmd = new NpgsqlCommand(sql, conn);
        foreach (var arg in args) cmd.Parameters.Add(new NpgsqlParameter { Value = arg });
        return (T)(await cmd.ExecuteScalarAsync())!;
    }

    public static Task<int> CurrentVersionIdAsync() =>
        ScalarAsync<int>("SELECT version_id FROM current_version WHERE id = 1");

    public static Task<long> FeatureCountAsync(string layerName) =>
        ScalarAsync<long>("SELECT count(*) FROM current_feature WHERE layer_name = $1", layerName);

    /// <summary>Empties the database, as on a new installation. The next test's reset restores it.</summary>
    public static async Task ClearAsync()
    {
        await using var conn = await OpenAsync();
        await Exec(conn, $"TRUNCATE {Tables} RESTART IDENTITY CASCADE");
    }

    /// <summary>Removes a file from the current version directly in the database (test setup only).</summary>
    public static async Task RemoveCurrentFileAsync(string path)
    {
        await using var conn = await OpenAsync();
        await using var cmd = new NpgsqlCommand(
            "DELETE FROM version_file WHERE path = $1 AND version_id = (SELECT version_id FROM current_version WHERE id = 1)", conn);
        cmd.Parameters.Add(new NpgsqlParameter { Value = path });
        if (await cmd.ExecuteNonQueryAsync() != 1) throw new InvalidOperationException($"{path} is not in the current version.");
    }

    public static async Task<List<string>> CurrentPathsAsync()
    {
        await using var conn = await OpenAsync();
        await using var cmd = new NpgsqlCommand(
            "SELECT f.path FROM current_version c JOIN version_file f ON f.version_id = c.version_id ORDER BY f.path", conn);
        var paths = new List<string>();
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync()) paths.Add(reader.GetString(0));
        return paths;
    }

    // ─── Internals ───────────────────────────────────────────────────────────

    private static async Task Exec(NpgsqlConnection conn, string sql)
    {
        await using var cmd = new NpgsqlCommand(sql, conn);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task<List<object?[]>> ReadRows(NpgsqlConnection conn, string sql)
    {
        var rows = new List<object?[]>();
        await using var cmd = new NpgsqlCommand(sql, conn);
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            var row = new object?[reader.FieldCount];
            for (var i = 0; i < row.Length; i++) row[i] = reader.IsDBNull(i) ? null : reader.GetValue(i);
            rows.Add(row);
        }
        return rows;
    }

    private static async Task Insert(NpgsqlConnection conn, string sql, List<object?[]> rows)
    {
        if (rows.Count == 0) return;
        await using var batch = new NpgsqlBatch(conn);
        foreach (var row in rows)
        {
            var cmd = new NpgsqlBatchCommand(sql);
            foreach (var value in row) cmd.Parameters.Add(new NpgsqlParameter { Value = value ?? DBNull.Value });
            batch.BatchCommands.Add(cmd);
        }
        await batch.ExecuteNonQueryAsync();
    }
}
