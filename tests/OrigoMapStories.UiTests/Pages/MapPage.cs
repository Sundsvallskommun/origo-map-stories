namespace OrigoMapStories.UiTests.Pages;

/// <summary>
/// The map page with the plugin button and its panels. <paramref name="appUrl"/>
/// is where the app lives, e.g. "http://proxy.test/maps/stories" behind a proxy;
/// empty means the context's base URL.
/// </summary>
public class MapPage(IPage page, string appUrl = "")
{
    public IPage Page { get; } = page;

    public ILocator PluginButton => Page.Locator(".o-mapstories").First;
    public LoginModal Login => new(Page);
    public LayerPanel LayerPanel => new(Page);
    public TextPanel TextPanel => new(Page);
    public SiteConfigEditor SiteConfig => new(Page);
    public GeoJsonEditor MapEditor => new(Page);

    public async Task GotoAsync(bool admin = false)
    {
        await Page.GotoAsync(admin ? $"{appUrl}/?admin" : $"{appUrl}/");
        await Assertions.Expect(PluginButton).ToBeVisibleAsync();
        // The site config is loaded asynchronously after the plugin renders;
        // the corner logo is mounted once it has arrived.
        await Assertions.Expect(Page.Locator(".o-mapstories-corner-logo")).ToBeAttachedAsync();
    }

    public async Task<LayerPanel> OpenLayerPanelAsync()
    {
        await PluginButton.ClickAsync();
        await Assertions.Expect(LayerPanel.Root).ToBeVisibleAsync();
        return LayerPanel;
    }

    /// <summary>Opens the layer panel and selects menu → submenu; returns the text panel.</summary>
    public async Task<TextPanel> OpenLayerAsync(string menu, string item)
    {
        if (!await LayerPanel.Root.IsVisibleAsync()) await OpenLayerPanelAsync();
        await LayerPanel.SelectAsync(menu, item);
        await TextPanel.WaitForContentAsync();
        return TextPanel;
    }

    // ─── Map helpers ─────────────────────────────────────────────────────────
    // All coordinates are in the data projection (SWEREF 99 TM, EPSG:3006) and
    // converted to the map's projection (EPSG:3857 in index.json) in the page.

    private const string ToMap = "c => Origo.ol.proj.transform(c, 'EPSG:3006', origo.api().getProjection().getCode())";

    /// <summary>
    /// Zooms the map to an extent [minX, minY, maxX, maxY] immediately (no
    /// animation). The extent is placed in the upper-left part of the map,
    /// clear of Origo's legend panel in the bottom-right corner.
    /// </summary>
    public Task FitAsync(double[] extent) =>
        Page.EvaluateAsync(
            @"ext => {
                const map = origo.api().getMap();
                const mapExt = Origo.ol.proj.transformExtent(ext, 'EPSG:3006', origo.api().getProjection().getCode());
                const [width, height] = map.getSize();
                map.getView().cancelAnimations();
                map.getView().fit(mapExt, { padding: [60, Math.round(width * 0.45), Math.round(height * 0.55), 60] });
                map.renderSync();
            }", extent);

    /// <summary>Screen position (page pixels) of a coordinate. The coordinate must be inside the current view.</summary>
    public Task<double[]> ScreenPointAsync(double x, double y) =>
        Page.EvaluateAsync<double[]>(
            $@"coord => {{
                const toMap = {ToMap};
                const map = origo.api().getMap();
                map.renderSync();
                const px = map.getPixelFromCoordinate(toMap(coord));
                const box = map.getViewport().getBoundingClientRect();
                return [box.left + px[0], box.top + px[1]];
            }}", new[] { x, y });

    /// <summary>Clicks the map at a coordinate. The coordinate must be inside the current view.</summary>
    public async Task ClickMapAtAsync(double x, double y)
    {
        var point = await ScreenPointAsync(x, y);
        // Fail clearly if a control or panel covers that point instead of the map.
        var covering = await Page.EvaluateAsync<string?>(
            @"([px, py]) => {
                const el = document.elementFromPoint(px, py);
                const viewport = origo.api().getMap().getViewport();
                if (el && el.tagName === 'CANVAS' && viewport.contains(el)) return null;
                return el ? `${el.tagName}.${el.className}` : 'nothing (outside the page)';
            }", point);
        if (covering != null)
            throw new InvalidOperationException($"Map point ({x}, {y}) at screen ({point[0]:F0}, {point[1]:F0}) is covered by {covering}.");
        await Page.Mouse.ClickAsync((float)point[0], (float)point[1]);
    }

    /// <summary>The current map center (EPSG:3006) and zoom level.</summary>
    public async Task<(double X, double Y, double Zoom)> ViewAsync()
    {
        var v = await Page.EvaluateAsync<double[]>(
            @"() => {
                const view = origo.api().getMap().getView();
                const c = Origo.ol.proj.transform(view.getCenter(), origo.api().getProjection().getCode(), 'EPSG:3006');
                return [...c, view.getZoom()];
            }");
        return (v[0], v[1], v[2]);
    }

    public Task SetViewAsync(double x, double y, double zoom) =>
        Page.EvaluateAsync(
            $@"([x, y, zoom]) => {{
                const toMap = {ToMap};
                const map = origo.api().getMap();
                map.getView().cancelAnimations();
                map.getView().setCenter(toMap([x, y]));
                map.getView().setZoom(zoom);
                map.renderSync();
            }}", new[] { x, y, zoom });

    /// <summary>The current view resolution (map units per pixel).</summary>
    public Task<double> ResolutionAsync() =>
        Page.EvaluateAsync<double>("() => origo.api().getMap().getView().getResolution()");

    /// <summary>The smallest resolution the view itself allows (from the map configuration).</summary>
    public Task<double> MinResolutionAsync() =>
        Page.EvaluateAsync<double>("() => origo.api().getMap().getView().getMinResolution()");

    /// <summary>Waits until any running view animation has finished.</summary>
    public Task WaitForViewToSettleAsync() =>
        Page.WaitForFunctionAsync("() => !origo.api().getMap().getView().getAnimating()");

    /// <summary>
    /// The smallest distance in pixels from an extent (EPSG:3006) to the edge
    /// of the map. Negative when the extent reaches outside the map.
    /// </summary>
    public Task<double> ExtentMarginAsync(double[] extent) =>
        Page.EvaluateAsync<double>(
            @"ext => {
                const map = origo.api().getMap();
                const [minX, minY, maxX, maxY] = Origo.ol.proj.transformExtent(ext, 'EPSG:3006', origo.api().getProjection().getCode());
                map.renderSync();
                const [left, bottom] = map.getPixelFromCoordinate([minX, minY]);
                const [right, top] = map.getPixelFromCoordinate([maxX, maxY]);
                const [width, height] = map.getSize();
                return Math.min(left, top, width - right, height - bottom);
            }", extent);

    /// <summary>Closes Origo's feature info popup, which may cover the next point to click.</summary>
    public Task ClearFeatureInfoAsync() =>
        Page.EvaluateAsync("() => origo.api().getFeatureinfo().clear()");

    /// <summary>Whether an extent in map projection (as stored in data-extent) contains a EPSG:3006 coordinate.</summary>
    public Task<bool> MapExtentContainsAsync(string extentCsv, double x, double y) =>
        Page.EvaluateAsync<bool>(
            $@"([csv, x, y]) => {{
                const toMap = {ToMap};
                const [minX, minY, maxX, maxY] = csv.split(',').map(Number);
                const [cx, cy] = toMap([x, y]);
                return cx >= minX && cx <= maxX && cy >= minY && cy <= maxY;
            }}", new object[] { extentCsv, x, y });

    /// <summary>Converts EPSG:3006 coordinates to the map projection (e.g. for mocked WFS responses).</summary>
    public Task<double[][]> ToMapProjectionAsync(double[][] coords) =>
        Page.EvaluateAsync<double[][]>($"cs => {{ const toMap = {ToMap}; return cs.map(toMap); }}", coords);

    /// <summary>Number of features in the plugin's link-highlight layer (the topmost vector layer).</summary>
    public Task<int> HighlightCountAsync() =>
        Page.EvaluateAsync<int>(
            @"() => origo.api().getMap().getLayers().getArray()
                .filter(l => typeof l.getZIndex === 'function' && l.getZIndex() === 10000)
                .reduce((n, l) => n + l.getSource().getFeatures().length, 0)");

    /// <summary>Number of features currently loaded in an Origo layer's source.</summary>
    public Task<int> LoadedFeatureCountAsync(string layerName) =>
        Page.EvaluateAsync<int>(
            @"name => {
                const layer = origo.api().getLayer(name);
                return layer && layer.getSource() ? layer.getSource().getFeatures().length : 0;
            }", layerName);

    public Task SetLayerVisibleAsync(string layerName, bool visible) =>
        Page.EvaluateAsync("([name, v]) => origo.api().getLayer(name).setVisible(v)", new object[] { layerName, visible });

    public LinkMapModal LinkModal => new(Page);

    /// <summary>Whether the named Origo layer is currently visible on the map.</summary>
    public Task<bool> IsLayerVisibleAsync(string layerName) =>
        Page.EvaluateAsync<bool>(
            @"name => {
                const layer = origo.api().getLayer(name);
                return !!layer && layer.getVisible();
            }", layerName);
}
