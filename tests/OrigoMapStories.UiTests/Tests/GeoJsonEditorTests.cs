using System.Text.Json;
using OrigoMapStories.UiTests.Infrastructure;
using OrigoMapStories.UiTests.Pages;

namespace OrigoMapStories.UiTests.Tests;

/// <summary>The map editor (editor.html) opened from the text panel.</summary>
public class GeoJsonEditorTests : UiTestBase
{
    private MapPage _map = null!;

    private async Task<GeoJsonEditor> OpenEditorAsync()
    {
        _map = await OpenAsAdminAsync();
        var text = await _map.OpenLayerAsync("Bostäder", "Nuläge");
        await text.MapEditorButton.ClickAsync();
        await _map.MapEditor.WaitForLoadedAsync();
        return _map.MapEditor;
    }

    private async Task<int> SavedFeatureCountAsync() =>
        (await ApiGetJsonAsync("/api/geojson/Test_Bostader_Nulage")).GetProperty("features").GetArrayLength();

    [Test]
    public async Task Editor_opens_with_the_layers_features()
    {
        var editor = await OpenEditorAsync();

        await Expect(editor.Status).ToHaveTextAsync("2 objekt laddade");
        await Expect(editor.Symbol("node-main")).ToBeVisibleAsync();
    }

    [Test]
    public async Task Drawn_point_is_saved_to_the_overlay_and_the_feature_table()
    {
        var editor = await OpenEditorAsync();
        await editor.AddPointAsync("node-main", 200, 200);
        await editor.SaveAsync();

        await Expect(editor.Status).ToHaveTextAsync("Sparat – 3 objekt");
        Assert.That(await SavedFeatureCountAsync(), Is.EqualTo(3));
        Assert.That(await TestDatabase.FeatureCountAsync("Test_Bostader_Nulage"), Is.EqualTo(3));

        var saved = await ApiGetJsonAsync("/api/geojson/Test_Bostader_Nulage");
        var point = saved.GetProperty("features").EnumerateArray()
            .Single(f => f.GetProperty("geometry").GetProperty("type").GetString() == "Point");
        Assert.That(point.GetProperty("properties").GetProperty("symbolType").GetString(), Is.EqualTo("node-main"));
        Assert.That(saved.GetProperty("crs").GetProperty("properties").GetProperty("name").GetString(), Is.EqualTo("urn:ogc:def:crs:EPSG::3006"));

        var versions = await ListVersionsAsync();
        Assert.That(versions[0].GetProperty("description").GetString(), Is.EqualTo("Sparade kartlager: Bostäder › Nuläge"));
    }

    [Test]
    public async Task Selected_feature_can_be_deleted()
    {
        var editor = await OpenEditorAsync();
        await editor.AddPointAsync("node-main", 220, 220);
        await editor.SaveAsync();
        Assert.That(await SavedFeatureCountAsync(), Is.EqualTo(3));

        await editor.SelectTool.ClickAsync();
        await editor.Map.ClickAsync(new() { Position = new() { X = 220, Y = 220 } });
        await editor.DeleteTool.ClickAsync();
        await editor.SaveAsync();

        await Expect(editor.Status).ToHaveTextAsync("Sparat – 2 objekt");
        Assert.That(await SavedFeatureCountAsync(), Is.EqualTo(2));
        Assert.That(await TestDatabase.FeatureCountAsync("Test_Bostader_Nulage"), Is.EqualTo(2));
    }

    [Test]
    public async Task Closing_the_editor_reloads_the_layer_on_the_map()
    {
        var editor = await OpenEditorAsync();
        await editor.AddPointAsync("node-main", 200, 200);
        await editor.SaveAsync();
        await editor.CloseAsync();

        await WaitForValueAsync(() => Page.EvaluateAsync<int>(
                "() => origo.api().getLayer('Test_Bostader_Nulage').getSource().getFeatures().length"),
            3, "features on the map after closing the editor");
        Assert.That(await _map.IsLayerVisibleAsync("Test_Bostader_Nulage"), Is.True);
        await Expect(_map.TextPanel.Root).ToBeVisibleAsync();
    }

    [Test]
    public async Task Save_after_someone_else_changed_the_layer_gets_a_conflict()
    {
        var editor = await OpenEditorAsync();

        // Another admin saves the same layer in the meantime.
        var token = await GetAdminTokenAsync();
        var current = await ApiGetJsonAsync("/api/geojson/Test_Bostader_Nulage");
        var other = JsonSerializer.Deserialize<Dictionary<string, object>>(current.GetRawText())!;
        other["name"] = "Ändrat av någon annan";
        var put = await Page.APIRequest.PutAsync("/api/geojson/Test_Bostader_Nulage", new()
        {
            Headers = new Dictionary<string, string> { ["Authorization"] = $"Bearer {token}" },
            DataObject = other
        });
        Assert.That(put.Ok, Is.True);

        await editor.AddPointAsync("node-main", 200, 200);
        await editor.SaveButton.ClickAsync();

        await Expect(editor.Status).ToHaveTextAsync("Någon annan har sparat ändringar i detta innehåll. Ladda om för att se dem.");
        Assert.That(await SavedFeatureCountAsync(), Is.EqualTo(2));
    }
}
