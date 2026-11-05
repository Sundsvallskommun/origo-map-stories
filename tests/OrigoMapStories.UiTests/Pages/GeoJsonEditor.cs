using System.Text.Json;

namespace OrigoMapStories.UiTests.Pages;

/// <summary>
/// The map editor (editor.html) opened in an iframe modal from the text panel.
/// Map coordinates are EPSG:3006 (the editor map's own projection). Map state
/// is read through the editor's window.mapStoriesEditor hook.
/// </summary>
public class GeoJsonEditor(IPage page)
{
    public ILocator Modal => page.Locator("#o-map-editor-modal");
    public IFrameLocator Frame => Modal.FrameLocator("iframe");
    public ILocator Status => Frame.Locator("#ed-status");
    public ILocator SaveButton => Frame.Locator("#ed-btn-save");
    /// <summary>"Avbryt" (kept its old id).</summary>
    public ILocator CloseButton => Frame.Locator("#ed-btn-close");
    public ILocator SaveAndCloseButton => Frame.Locator("#ed-btn-save-close");
    public ILocator SelectTool => Frame.Locator("#ed-tool-select");
    public ILocator DeleteTool => Frame.Locator("#ed-tool-delete");
    public ILocator Map => Frame.Locator("#ed-map canvas").First;
    public ILocator SymbolButtons => Frame.Locator(".ed-sym-btn");
    public ILocator Symbol(string symbolId) => Frame.Locator($".ed-sym-btn[data-sym-id='{symbolId}']");
    // The #ed-login-dlg wrapper has no size of its own (its content is fixed-positioned).
    public ILocator LoginDialog => Frame.Locator("#ed-login-dlg .ed-dlg");
    public ILocator LoginPassword => Frame.Locator("#ed-login-pw");
    public ILocator LoginError => Frame.Locator("#ed-login-err");
    public ILocator LoginOk => Frame.Locator("#ed-login-ok");

    private IFrame EditorFrame =>
        page.Frames.FirstOrDefault(f => f.Url.Contains("editor.html"))
        ?? throw new InvalidOperationException("The map editor iframe is not open.");

    /// <summary>Waits until the layer has been loaded ("N objekt laddade" or "Nytt lager").</summary>
    public async Task WaitForLoadedAsync()
    {
        await Assertions.Expect(Modal).ToBeVisibleAsync();
        await Assertions.Expect(Status).ToHaveTextAsync(new System.Text.RegularExpressions.Regex("objekt laddade|Nytt lager"));
    }

    // ─── Map interaction ──────────────────────────────────────────────────────

    public Task FitAsync(double[] extent) =>
        EditorFrame.EvaluateAsync(
            @"ext => {
                const { map } = window.mapStoriesEditor;
                map.getView().cancelAnimations();
                map.getView().fit(ext, { padding: [60, 60, 60, 60] });
                map.renderSync();
            }", extent);

    /// <summary>Page coordinates of a map coordinate (iframe offset included).</summary>
    public async Task<(float X, float Y)> ScreenPointAsync(double x, double y)
    {
        var inFrame = await EditorFrame.EvaluateAsync<double[]>(
            @"coord => {
                const { map } = window.mapStoriesEditor;
                map.renderSync();
                const px = map.getPixelFromCoordinate(coord);
                const box = map.getViewport().getBoundingClientRect();
                return [box.left + px[0], box.top + px[1]];
            }", new[] { x, y });
        var frameBox = await Modal.Locator("iframe").BoundingBoxAsync()
            ?? throw new InvalidOperationException("The editor iframe has no size.");
        return ((float)(frameBox.X + inFrame[0]), (float)(frameBox.Y + inFrame[1]));
    }

    public async Task ClickAtAsync(double x, double y)
    {
        var (px, py) = await ScreenPointAsync(x, y);
        await page.Mouse.ClickAsync(px, py);
    }

    public async Task DoubleClickAtAsync(double x, double y)
    {
        var (px, py) = await ScreenPointAsync(x, y);
        await page.Mouse.DblClickAsync(px, py);
    }

    /// <summary>Drags with the mouse from one map coordinate to another.</summary>
    public async Task DragAsync(double[] from, double[] to)
    {
        var (fx, fy) = await ScreenPointAsync(from[0], from[1]);
        var (tx, ty) = await ScreenPointAsync(to[0], to[1]);
        await page.Mouse.MoveAsync(fx, fy);
        await page.Mouse.DownAsync();
        await page.Mouse.MoveAsync(fx + (tx - fx) / 2, fy + (ty - fy) / 2, new() { Steps = 5 });
        await page.Mouse.MoveAsync(tx, ty, new() { Steps = 5 });
        await page.Mouse.UpAsync();
    }

    /// <summary>Adds a point symbol by clicking the map at a position relative to the map's top-left corner.</summary>
    public async Task AddPointAsync(string symbolId, float x, float y)
    {
        await Symbol(symbolId).ClickAsync();
        await Map.ClickAsync(new() { Position = new() { X = x, Y = y } });
    }

    /// <summary>Draws a line or polygon through the given coordinates; the last vertex is double-clicked to finish.</summary>
    public async Task DrawAsync(string symbolId, params double[][] vertices)
    {
        await Symbol(symbolId).ClickAsync();
        for (var i = 0; i < vertices.Length - 1; i++) await ClickAtAsync(vertices[i][0], vertices[i][1]);
        var last = vertices[^1];
        await DoubleClickAtAsync(last[0], last[1]);
    }

    // ─── State through the test hook ─────────────────────────────────────────

    /// <summary>
    /// Asks the view for the given center and resolution and returns what it
    /// actually got after its constraints: [x, y, resolution].
    /// </summary>
    public Task<double[]> SetViewAsync(double x, double y, double resolution) =>
        EditorFrame.EvaluateAsync<double[]>(
            @"([x, y, res]) => {
                const view = window.mapStoriesEditor.map.getView();
                view.cancelAnimations();
                view.setCenter([x, y]);
                view.setResolution(res);
                window.mapStoriesEditor.map.renderSync();
                const c = view.getCenter();
                return [c[0], c[1], view.getResolution()];
            }", new[] { x, y, resolution });

    public Task<int> FeatureCountAsync() =>
        EditorFrame.EvaluateAsync<int>("() => window.mapStoriesEditor.source.getFeatures().length");

    public Task<int> SelectedCountAsync() =>
        EditorFrame.EvaluateAsync<int>("() => window.mapStoriesEditor.selected.getLength()");

    /// <summary>Geometry type and symbolType of every feature, plus its coordinates as JSON.</summary>
    public async Task<List<(string Type, string? Symbol, JsonElement Coordinates)>> FeaturesAsync()
    {
        var json = await EditorFrame.EvaluateAsync<JsonElement>(
            @"() => window.mapStoriesEditor.source.getFeatures().map(f => ({
                type: f.getGeometry().getType(),
                symbol: f.get('symbolType') || null,
                coordinates: f.getGeometry().getCoordinates()
            }))");
        return json.EnumerateArray().Select(f => (
            f.GetProperty("type").GetString()!,
            f.GetProperty("symbol").ValueKind == JsonValueKind.Null ? null : f.GetProperty("symbol").GetString(),
            f.GetProperty("coordinates").Clone())).ToList();
    }

    /// <summary>
    /// The OpenLayers styles the editor's layer gives the features with a
    /// symbolType (or the first feature without one when null), summarised as
    /// plain values: [{ circleRadius, circleFill, stroke, strokeWidth, lineDash, fill, shapePoints }].
    /// </summary>
    public Task<JsonElement> StylesForAsync(string? symbolType) =>
        EditorFrame.EvaluateAsync<JsonElement>(
            @"symbolType => {
                const { layer, source, map } = window.mapStoriesEditor;
                const feature = source.getFeatures().find(f => (f.get('symbolType') || null) === symbolType);
                if (!feature) return null;
                let styles = layer.getStyleFunction()(feature, map.getView().getResolution());
                styles = Array.isArray(styles) ? styles : [styles];
                const color = c => (c == null ? null : (Array.isArray(c) ? `rgba(${c.join(',')})` : String(c)));
                return styles.map(s => {
                    const image = s.getImage();
                    const stroke = s.getStroke();
                    const fill = s.getFill();
                    return {
                        circleRadius: image && image.getRadius ? image.getRadius() : null,
                        circleFill: image && image.getFill && image.getFill() ? color(image.getFill().getColor()) : null,
                        // Circles are RegularShapes with Infinity points; only report real polygons.
                        shapePoints: image && image.getPoints && Number.isFinite(image.getPoints()) ? image.getPoints() : null,
                        stroke: stroke ? color(stroke.getColor()) : null,
                        strokeWidth: stroke ? stroke.getWidth() : null,
                        lineDash: stroke ? stroke.getLineDash() : null,
                        fill: fill ? color(fill.getColor()) : null
                    };
                });
            }", symbolType);

    // ─── Save / close / login ─────────────────────────────────────────────────

    public async Task SaveAsync()
    {
        await SaveButton.ClickAsync();
        await Assertions.Expect(Status).ToHaveTextAsync(new System.Text.RegularExpressions.Regex("^Sparat"));
    }

    /// <summary>Clicks "Avbryt" with nothing unsaved and waits for the editor to close.</summary>
    public async Task CloseAsync()
    {
        await CloseButton.ClickAsync();
        await Assertions.Expect(Modal).ToBeHiddenAsync();
    }

    /// <summary>"Spara och stäng": saves and waits for the editor to close.</summary>
    public async Task SaveAndCloseAsync()
    {
        await SaveAndCloseButton.ClickAsync();
        await Assertions.Expect(Modal).ToBeHiddenAsync();
    }

    /// <summary>
    /// Clicks "Avbryt", answering an unsaved-changes prompt with accept or
    /// dismiss. Returns the prompts shown (empty when nothing was unsaved).
    /// </summary>
    public Task<List<string>> CancelAsync(bool accept = true) =>
        ConfirmDialog.HandleAsync(page, () => CloseButton.ClickAsync(), accept);

    /// <summary>Presses Escape in the editor, answering an unsaved-changes prompt.</summary>
    public Task<List<string>> PressEscapeAsync(bool accept = true) =>
        ConfirmDialog.HandleAsync(page, () => page.Keyboard.PressAsync("Escape"), accept);
}
