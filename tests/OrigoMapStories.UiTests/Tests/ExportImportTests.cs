using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using OrigoMapStories.UiTests.Infrastructure;
using OrigoMapStories.UiTests.Pages;

namespace OrigoMapStories.UiTests.Tests;

/// <summary>Export of a version to a zip file and import of zip files.</summary>
public class ExportImportTests : UiTestBase
{
    private MapPage _map = null!;

    private async Task<VersionsTab> OpenVersionsAsync()
    {
        _map = await OpenAsAdminAsync();
        var panel = await _map.OpenLayerPanelAsync();
        await _map.SiteConfig.OpenAsync(panel);
        await _map.SiteConfig.SelectTabAsync("versioner");
        await _map.SiteConfig.Versions.WaitForRowsAsync(1);
        return _map.SiteConfig.Versions;
    }

    private static string TempDir =>
        Path.Combine(TestContext.CurrentContext.WorkDirectory, "tmp", TestContext.CurrentContext.Test.MethodName!);

    [SetUp]
    public void CleanTempDir()
    {
        if (Directory.Exists(TempDir)) Directory.Delete(TempDir, recursive: true);
    }

    private static string TempFile(string name)
    {
        Directory.CreateDirectory(TempDir);
        return Path.Combine(TempDir, name);
    }

    private static Dictionary<string, byte[]> ReadZip(string path)
    {
        using var zip = ZipFile.OpenRead(path);
        return zip.Entries.Where(e => !e.FullName.EndsWith('/')).ToDictionary(e => e.FullName, e =>
        {
            using var s = e.Open();
            using var ms = new MemoryStream();
            s.CopyTo(ms);
            return ms.ToArray();
        });
    }

    private static string WriteZip(string name, IDictionary<string, byte[]> entries)
    {
        var path = TempFile(name);
        using var zip = ZipFile.Open(path, ZipArchiveMode.Create);
        foreach (var (entryName, data) in entries)
        {
            using var s = zip.CreateEntry(entryName).Open();
            s.Write(data);
        }
        return path;
    }

    /// <summary>Exports the current version through the UI and returns the saved zip path.</summary>
    private async Task<string> ExportCurrentAsync(VersionsTab versions)
    {
        var download = await versions.ExportAsync(versions.ExportCurrentButton);
        var path = TempFile(download.SuggestedFilename);
        await download.SaveAsAsync(path);
        return path;
    }

    private static string Sha256(byte[] data) => Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant();

    [Test]
    public async Task Export_contains_a_readable_complete_version()
    {
        var versions = await OpenVersionsAsync();
        var download = await versions.ExportAsync(versions.ExportButton(1));

        Assert.That(download.SuggestedFilename, Does.Match(@"^origo-map-stories_v1_\d{4}-\d{2}-\d{2}_\d{4}\.zip$"));
        var path = TempFile(download.SuggestedFilename);
        await download.SaveAsAsync(path);
        var files = ReadZip(path);

        Assert.That(files.Keys, Is.SupersetOf(new[]
        {
            "manifest.json", "LÄSMIG.txt", "site-config.json",
            "layers/Test_Bostader_Nulage/overlay.geojson", "layers/Test_Bostader_Nulage/text.json", "layers/Test_Bostader_Nulage/text.html",
            "layers/Test_Bostader_Framtid/overlay.geojson",
            "layers/Test_Kollektivtrafik/overlay.geojson", "layers/Test_Kollektivtrafik/text.json",
            "images/fixture-bild.png",
            "site-assets/button-icon.png", "site-assets/corner-logo.png", "site-assets/header-image.png"
        }));

        using var manifest = JsonDocument.Parse(files["manifest.json"]);
        Assert.That(manifest.RootElement.GetProperty("format").GetString(), Is.EqualTo("origo-map-stories-content"));
        Assert.That(manifest.RootElement.GetProperty("formatVersion").GetInt32(), Is.EqualTo(1));
        Assert.That(manifest.RootElement.GetProperty("source").GetProperty("versionId").GetInt32(), Is.EqualTo(1));
        var listed = manifest.RootElement.GetProperty("files").EnumerateArray().ToList();
        Assert.That(listed, Has.Count.EqualTo(10));
        foreach (var file in listed)
        {
            var p = file.GetProperty("path").GetString()!;
            Assert.That(Sha256(files[p]), Is.EqualTo(file.GetProperty("sha256").GetString()), $"sha256 of {p}");
        }
    }

    [Test]
    public async Task Exported_text_html_is_readable_offline()
    {
        var versions = await OpenVersionsAsync();
        var files = ReadZip(await ExportCurrentAsync(versions));

        var html = Encoding.UTF8.GetString(files["layers/Test_Bostader_Nulage/text.html"]);
        Assert.That(html, Does.Contain("<h1>Bostäder nuläge</h1>"));
        Assert.That(html, Does.Contain("<span class=\"map-link\" title=\"Kartlänk\">centrumområdet</span>"));
        Assert.That(html, Does.Contain("src=\"../../images/fixture-bild.png\""));
    }

    [Test]
    public async Task Importing_an_export_restores_its_content_as_a_new_version()
    {
        var versions = await OpenVersionsAsync();
        var zip = await ExportCurrentAsync(versions);

        await _map.SiteConfig.SelectTabAsync("menyer");
        await _map.SiteConfig.MenuLabel(0).FillAsync("Ändrad meny");
        await _map.SiteConfig.SaveAsync();
        await _map.SiteConfig.SelectTabAsync("versioner");
        await versions.WaitForRowsAsync(2);

        await versions.ImportAsync(zip);

        await Expect(_map.SiteConfig.Status).ToHaveTextAsync("Importerad som version 3.");
        await versions.WaitForRowsAsync(3);
        await Expect(versions.CurrentRow).ToHaveAttributeAsync("data-version-id", "3");
        await Expect(versions.Description(3)).ToHaveTextAsync(new Regex(@"^Importerad: origo-map-stories_v1_.*\.zip \(v1 från 127\.0\.0\.1:\d+\)$"));
        Assert.That(await _map.LayerPanel.SectionLabelsAsync(), Is.EqualTo(new[] { "Bostäder", "Trafik" }));

        var identical = await TestDatabase.CountAsync(
            "SELECT count(*) FROM (SELECT path, sha256 FROM version_file WHERE version_id = 1 EXCEPT SELECT path, sha256 FROM version_file WHERE version_id = 3) d");
        Assert.That(identical, Is.EqualTo(0), "imported version must equal the exported one");
    }

    [Test]
    public async Task Hand_edited_zip_is_imported_and_marked_as_modified()
    {
        var versions = await OpenVersionsAsync();
        var files = ReadZip(await ExportCurrentAsync(versions));
        var config = JsonNodeEdit(files["site-config.json"], "headerText", "Handredigerad rubrik");
        files["site-config.json"] = config;

        await versions.ImportAsync(WriteZip("handredigerad.zip", files));

        await Expect(_map.SiteConfig.Status).ToHaveTextAsync("Importerad som version 2. 1 filer var manuellt ändrade.");
        await Expect(versions.Description(2)).ToContainTextAsync("manuellt ändrad (1 filer)");
        await _map.SiteConfig.CloseAsync();
        await Expect(_map.LayerPanel.Title).ToHaveTextAsync("Handredigerad rubrik");
    }

    [Test]
    public async Task Legacy_structuremaphelper_export_is_accepted()
    {
        var versions = await OpenVersionsAsync();
        var files = ReadZip(await ExportCurrentAsync(versions));
        files["manifest.json"] = JsonNodeEdit(files["manifest.json"], "format", "structuremaphelper-content");

        await versions.ImportAsync(WriteZip("strukturkarta_v1_2026-01-01_1200.zip", files));

        await Expect(_map.SiteConfig.Status).ToHaveTextAsync("Importerad som version 2.");
        await Expect(versions.CurrentRow).ToHaveAttributeAsync("data-version-id", "2");
    }

    [Test]
    public async Task Zip_with_unknown_format_is_rejected()
    {
        var versions = await OpenVersionsAsync();
        var files = ReadZip(await ExportCurrentAsync(versions));
        files["manifest.json"] = JsonNodeEdit(files["manifest.json"], "format", "annat-format");

        await versions.ImportAsync(WriteZip("annat-format.zip", files));

        await Expect(_map.SiteConfig.Status).ToHaveTextAsync("Okänt format \"annat-format\" – filen är inte en export från Origo Map Stories");
        Assert.That(await TestDatabase.CountAsync("SELECT count(*) FROM version"), Is.EqualTo(1));
    }

    [Test]
    public async Task Zip_repacked_inside_a_folder_is_accepted()
    {
        var versions = await OpenVersionsAsync();
        var files = ReadZip(await ExportCurrentAsync(versions));
        var nested = files.ToDictionary(kv => $"origo-map-stories_v1/{kv.Key}", kv => kv.Value);

        await versions.ImportAsync(WriteZip("komprimerad-mapp.zip", nested));

        await Expect(_map.SiteConfig.Status).ToHaveTextAsync("Importerad som version 2.");
    }

    [Test]
    public async Task Broken_zip_is_rejected()
    {
        var versions = await OpenVersionsAsync();
        var path = TempFile("trasig.zip");
        await File.WriteAllTextAsync(path, "det här är ingen zip-fil");

        await versions.ImportAsync(path);

        await Expect(_map.SiteConfig.Status).ToContainTextAsync("Filen är inte en giltig zip-fil");
        Assert.That(await TestDatabase.CountAsync("SELECT count(*) FROM version"), Is.EqualTo(1));
    }

    [Test]
    public async Task Zip_with_path_traversal_is_rejected()
    {
        var versions = await OpenVersionsAsync();
        var files = ReadZip(await ExportCurrentAsync(versions));
        files["../evil.txt"] = Encoding.UTF8.GetBytes("ond");

        await versions.ImportAsync(WriteZip("evil.zip", files));

        await Expect(_map.SiteConfig.Status).ToContainTextAsync("Zip-filen är skadad");
        Assert.That(await TestDatabase.CountAsync("SELECT count(*) FROM version"), Is.EqualTo(1));
    }

    [Test]
    public async Task Zip_with_unknown_files_is_rejected()
    {
        var versions = await OpenVersionsAsync();
        var files = ReadZip(await ExportCurrentAsync(versions));
        files["scripts/hack.js"] = Encoding.UTF8.GetBytes("alert(1)");

        await versions.ImportAsync(WriteZip("okand-fil.zip", files));

        await Expect(_map.SiteConfig.Status).ToHaveTextAsync("Otillåtna filer i zip-filen: scripts/hack.js");
        Assert.That(await TestDatabase.CountAsync("SELECT count(*) FROM version"), Is.EqualTo(1));
    }

    [Test]
    public async Task Zip_without_manifest_is_rejected()
    {
        var versions = await OpenVersionsAsync();
        var files = ReadZip(await ExportCurrentAsync(versions));
        files.Remove("manifest.json");

        await versions.ImportAsync(WriteZip("utan-manifest.zip", files));

        await Expect(_map.SiteConfig.Status).ToHaveTextAsync("manifest.json saknas – filen är inte en export från Origo Map Stories");
    }

    [Test]
    public async Task Zip_with_invalid_geojson_is_rejected()
    {
        var versions = await OpenVersionsAsync();
        var files = ReadZip(await ExportCurrentAsync(versions));
        files["layers/Test_Kollektivtrafik/overlay.geojson"] = Encoding.UTF8.GetBytes("{\"type\":\"Feature\"}");

        await versions.ImportAsync(WriteZip("fel-geojson.zip", files));

        await Expect(_map.SiteConfig.Status).ToHaveTextAsync("layers/Test_Kollektivtrafik/overlay.geojson är inte en GeoJSON FeatureCollection");
        Assert.That(await TestDatabase.CountAsync("SELECT count(*) FROM version"), Is.EqualTo(1));
    }

    private static byte[] JsonNodeEdit(byte[] json, string property, string value)
    {
        var node = System.Text.Json.Nodes.JsonNode.Parse(json)!;
        node[property] = value;
        return Encoding.UTF8.GetBytes(node.ToJsonString());
    }
}
