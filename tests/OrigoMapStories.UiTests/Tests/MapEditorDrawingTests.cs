using System.Text.Json;
using OrigoMapStories.UiTests.Infrastructure;
using OrigoMapStories.UiTests.Pages;

namespace OrigoMapStories.UiTests.Tests;

/// <summary>
/// The map editor beyond points: lines and areas, keyboard shortcuts, moving
/// features, the symbol styles and the editor's own login dialog.
/// </summary>
public class MapEditorDrawingTests : UiTestBase
{
    private static readonly double[] BostaderExtent = [608000, 6912000, 638000, 6948000];
    private static readonly double[] B1 = [616000, 6920000];
    private MapPage _map = null!;

    private async Task<GeoJsonEditor> OpenEditorAsync()
    {
        _map = await OpenAsAdminAsync();
        var text = await _map.OpenLayerAsync("Bostäder", "Nuläge");
        await text.MapEditorButton.ClickAsync();
        var editor = _map.MapEditor;
        await editor.WaitForLoadedAsync();
        await editor.FitAsync(BostaderExtent);
        return editor;
    }

    private async Task<JsonElement> SavedFeaturesAsync() =>
        (await ApiGetJsonAsync("/api/geojson/Test_Bostader_Nulage")).GetProperty("features");

    private static List<double[]> Coordinates(JsonElement coords) =>
        coords.EnumerateArray().Select(c => c.EnumerateArray().Select(v => v.GetDouble()).ToArray()).ToList();

    [Test]
    public async Task Symbol_panel_lists_all_symbols_in_four_categories()
    {
        var editor = await OpenEditorAsync();

        await Expect(editor.SymbolButtons).ToHaveCountAsync(12);
        foreach (var id in new[] { "node-regional", "node-small", "corridor-major", "corridor-dashed", "arrow-regional", "arrow-water", "area-region", "area-urban" })
            await Expect(editor.Symbol(id)).ToBeVisibleAsync();
    }

    [Test]
    public async Task Line_is_drawn_with_its_symbol_and_saved()
    {
        var editor = await OpenEditorAsync();

        await editor.DrawAsync("corridor-major", [610000, 6914000], [620000, 6930000], [634000, 6946000]);

        var line = (await editor.FeaturesAsync()).Single(f => f.Type == "LineString");
        Assert.That(line.Symbol, Is.EqualTo("corridor-major"));
        Assert.That(Coordinates(line.Coordinates), Has.Count.GreaterThanOrEqualTo(3));
        await editor.SaveAsync();

        var saved = (await SavedFeaturesAsync()).EnumerateArray().Single(f => f.GetProperty("geometry").GetProperty("type").GetString() == "LineString");
        Assert.That(saved.GetProperty("properties").GetProperty("symbolType").GetString(), Is.EqualTo("corridor-major"));
        Assert.That(await TestDatabase.FeatureCountAsync("Test_Bostader_Nulage"), Is.EqualTo(3));
    }

    [Test]
    public async Task Area_is_drawn_as_a_closed_polygon_and_saved()
    {
        var editor = await OpenEditorAsync();

        await editor.DrawAsync("area-urban", [622000, 6914000], [636000, 6914000], [636000, 6926000], [622000, 6926000]);

        var area = (await editor.FeaturesAsync()).Single(f => f.Symbol == "area-urban");
        Assert.That(area.Type, Is.EqualTo("Polygon"));
        var ring = Coordinates(area.Coordinates[0]);
        Assert.That(ring, Has.Count.GreaterThanOrEqualTo(4));
        Assert.That(ring[0], Is.EqualTo(ring[^1]), "the ring must be closed");
        await editor.SaveAsync();
        await Expect(editor.Status).ToHaveTextAsync("Sparat – 3 objekt");
    }

    [Test]
    public async Task Escape_aborts_drawing_and_returns_to_select_mode()
    {
        var editor = await OpenEditorAsync();
        await editor.Symbol("corridor-minor").ClickAsync();
        await Expect(editor.Symbol("corridor-minor")).ToHaveClassAsync(new System.Text.RegularExpressions.Regex("is-active"));
        await editor.ClickAtAsync(610000, 6914000);
        await editor.ClickAtAsync(620000, 6930000);

        await page_Keyboard("Escape");

        Assert.That(await editor.FeatureCountAsync(), Is.EqualTo(2), "no line may be added");
        await Expect(editor.SelectTool).ToHaveClassAsync(new System.Text.RegularExpressions.Regex("is-active"));
        await Expect(editor.Symbol("corridor-minor")).Not.ToHaveClassAsync(new System.Text.RegularExpressions.Regex("is-active"));
    }

    [Test]
    public async Task Delete_key_removes_the_selected_feature()
    {
        var editor = await OpenEditorAsync();
        await editor.SelectTool.ClickAsync();
        await editor.ClickAtAsync(B1[0], B1[1]);
        await WaitForValueAsync(() => editor.SelectedCountAsync(), 1, "B1 selected");

        await page_Keyboard("Delete");

        Assert.That(await editor.FeatureCountAsync(), Is.EqualTo(1));
        await editor.SaveAsync();
        var ids = (await SavedFeaturesAsync()).EnumerateArray().Select(f => f.GetProperty("properties").GetProperty("fid").GetString());
        Assert.That(ids, Is.EqualTo(new[] { "B2" }));
    }

    [Test]
    public async Task Selected_feature_can_be_moved_by_dragging()
    {
        var editor = await OpenEditorAsync();
        await editor.SelectTool.ClickAsync();
        await editor.ClickAtAsync(B1[0], B1[1]);
        await WaitForValueAsync(() => editor.SelectedCountAsync(), 1, "B1 selected");

        await editor.DragAsync(B1, [B1[0] + 6000, B1[1] + 4000]);
        await editor.SaveAsync();

        var b1 = (await SavedFeaturesAsync()).EnumerateArray().Single(f => f.GetProperty("properties").GetProperty("fid").GetString() == "B1");
        var ring = Coordinates(b1.GetProperty("geometry").GetProperty("coordinates")[0]);
        var centerX = ring.Take(4).Average(c => c[0]);
        var centerY = ring.Take(4).Average(c => c[1]);
        Assert.That(centerX, Is.EqualTo(B1[0] + 6000).Within(800), "moved east");
        Assert.That(centerY, Is.EqualTo(B1[1] + 4000).Within(800), "moved north");
    }

    [Test]
    public async Task Map_can_be_panned_and_zoomed_beyond_the_background_tile_grid()
    {
        var editor = await OpenEditorAsync();

        // The tile grid ends at resolution 0.056 (in) and 280 (out) and covers
        // [461400, 6803000, 773960, 7110000]; the view is no longer bound to it.
        var zoomedIn = await editor.SetViewAsync(616000, 6920000, 0.01);
        Assert.That(zoomedIn[2], Is.EqualTo(0.01).Within(1e-6), "zoom in past the last tile level");

        var zoomedOut = await editor.SetViewAsync(616000, 6920000, 2000);
        Assert.That(zoomedOut[2], Is.EqualTo(2000).Within(1e-6), "zoom out past the first tile level");

        var outside = await editor.SetViewAsync(300000, 7400000, 140);
        Assert.That(outside[0], Is.EqualTo(300000).Within(1e-6), "pan west of the old extent");
        Assert.That(outside[1], Is.EqualTo(7400000).Within(1e-6), "pan north of the old extent");

        // Resolutions are no longer snapped to the old fixed list.
        var between = await editor.SetViewAsync(616000, 6920000, 50);
        Assert.That(between[2], Is.EqualTo(50).Within(1e-6));
    }

    // ─── Symbol styles (olStyleBuilder) ──────────────────────────────────────

    [Test]
    public async Task Node_symbol_is_drawn_as_rings_with_a_dark_center()
    {
        var editor = await OpenEditorAsync();
        await editor.Symbol("node-regional").ClickAsync();
        await editor.ClickAtAsync(624000, 6934000);

        var styles = (await editor.StylesForAsync("node-regional")).EnumerateArray().ToList();

        Assert.That(styles, Has.Count.EqualTo(6), "4 rings + inner circle + center dot");
        Assert.That(styles[0].GetProperty("circleRadius").GetDouble(), Is.EqualTo(28));
        Assert.That(styles[0].GetProperty("circleFill").GetString(), Is.EqualTo("rgba(215,70,25,1)"));
        Assert.That(styles[1].GetProperty("circleFill").GetString(), Is.EqualTo("rgba(255,255,255,1)"), "rings alternate with white");
        Assert.That(styles[^1].GetProperty("circleFill").GetString(), Is.EqualTo("rgba(25,15,5,0.9)"));
    }

    [Test]
    public async Task Planned_corridor_is_a_dashed_line()
    {
        var editor = await OpenEditorAsync();
        await editor.DrawAsync("corridor-dashed", [610000, 6914000], [634000, 6946000]);

        var style = (await editor.StylesForAsync("corridor-dashed")).EnumerateArray().Single();

        Assert.That(style.GetProperty("stroke").GetString(), Is.EqualTo("rgba(215,95,35,0.85)"));
        Assert.That(style.GetProperty("strokeWidth").GetDouble(), Is.EqualTo(8));
        Assert.That(style.GetProperty("lineDash").EnumerateArray().Select(v => v.GetDouble()), Is.EqualTo(new[] { 14.0, 8.0 }));
    }

    [Test]
    public async Task Arrow_symbol_gets_an_arrowhead_at_the_end()
    {
        var editor = await OpenEditorAsync();
        await editor.DrawAsync("arrow-regional", [610000, 6914000], [634000, 6946000]);

        var styles = (await editor.StylesForAsync("arrow-regional")).EnumerateArray().ToList();

        Assert.That(styles, Has.Count.EqualTo(2), "line + arrowhead");
        Assert.That(styles[1].GetProperty("shapePoints").GetInt32(), Is.EqualTo(3), "triangle");
    }

    [Test]
    public async Task Area_symbol_has_fill_and_outline()
    {
        var editor = await OpenEditorAsync();
        await editor.DrawAsync("area-region", [622000, 6914000], [636000, 6914000], [636000, 6926000]);

        var style = (await editor.StylesForAsync("area-region")).EnumerateArray().Single();

        Assert.That(style.GetProperty("fill").GetString(), Is.EqualTo("rgba(120,190,80,0.25)"));
        Assert.That(style.GetProperty("stroke").GetString(), Is.EqualTo("rgba(80,150,40,0.8)"));
    }

    [Test]
    public async Task Features_without_symbol_get_the_default_style()
    {
        var editor = await OpenEditorAsync();

        var style = (await editor.StylesForAsync(null)).EnumerateArray().Single();

        Assert.That(style.GetProperty("fill").GetString(), Is.EqualTo("rgba(100,100,200,0.2)"));
        Assert.That(style.GetProperty("stroke").GetString(), Is.EqualTo("rgba(60,60,180,0.8)"));
    }

    // ─── The editor's own login ──────────────────────────────────────────────

    [Test]
    public async Task Saving_without_a_session_asks_for_login_and_then_saves()
    {
        var editor = await OpenEditorAsync();
        await editor.AddPointAsync("node-main", 200, 200);
        await Page.EvaluateAsync("() => localStorage.removeItem('cms_token')");

        await editor.SaveButton.ClickAsync();

        await Expect(editor.LoginDialog).ToBeVisibleAsync();
        await editor.LoginPassword.FillAsync("fel");
        await editor.LoginOk.ClickAsync();
        await Expect(editor.LoginError).ToHaveTextAsync("Fel lösenord");

        await editor.LoginPassword.FillAsync(TestSettings.AdminPassword);
        await editor.LoginOk.ClickAsync();
        await Expect(editor.LoginDialog).ToHaveCountAsync(0);
        await Expect(editor.Status).ToHaveTextAsync("Sparat – 3 objekt");
    }

    [Test]
    public async Task Rejected_session_on_save_asks_for_login()
    {
        var editor = await OpenEditorAsync();
        await editor.AddPointAsync("node-main", 200, 200);
        await Page.EvaluateAsync("() => localStorage.setItem('cms_token', 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYWRtaW4iLCJleHAiOjk5OTk5OTk5OTl9.bad')");

        await editor.SaveButton.ClickAsync();

        await Expect(editor.LoginDialog).ToBeVisibleAsync();
        await Expect(editor.Status).ToHaveTextAsync("Session utgången");
        Assert.That((await SavedFeaturesAsync()).GetArrayLength(), Is.EqualTo(2), "nothing saved");
    }

    private Task page_Keyboard(string key) => Page.Keyboard.PressAsync(key);
}
