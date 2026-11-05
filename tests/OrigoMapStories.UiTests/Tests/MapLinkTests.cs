using System.Text.Json;
using OrigoMapStories.UiTests.Infrastructure;
using OrigoMapStories.UiTests.Pages;

namespace OrigoMapStories.UiTests.Tests;

/// <summary>
/// Links between text and map — the plugin's core feature: clicking linked
/// text zooms to the object, clicking an object highlights its text, and the
/// "Koppla till karta" dialog creates and removes links.
/// </summary>
public class MapLinkTests : UiTestBase
{
    // Fixture geometry (EPSG:3006): squares of ±4000 m around these centers.
    private static readonly double[] B1 = [616000, 6920000];
    private static readonly double[] B2 = [630000, 6940000];
    private static readonly double[] BostaderExtent = [608000, 6912000, 638000, 6948000];
    private static readonly double[] EmptySpot = [623000, 6930000];

    private static bool Inside(double x, double y, double[] center, double half = 4000) =>
        Math.Abs(x - center[0]) <= half && Math.Abs(y - center[1]) <= half;

    private async Task<TextPanel> OpenBostaderAsync(bool admin)
    {
        var map = admin ? await OpenAsAdminAsync() : Map;
        if (!admin) await map.GotoAsync();
        var text = await map.OpenLayerAsync("Bostäder", "Nuläge");
        await WaitForValueAsync(() => Map.LoadedFeatureCountAsync("Test_Bostader_Nulage"), 2, "fixture features loaded");
        return text;
    }

    // ─── Text → map / map → text ─────────────────────────────────────────────

    [Test]
    public async Task Clicking_linked_text_zooms_to_the_object_and_highlights_it()
    {
        var text = await OpenBostaderAsync(admin: false);
        await Map.SetViewAsync(700000, 7050000, 3);

        await text.MapLinks.First.ClickAsync();

        await WaitForValueAsync(async () => { var v = await Map.ViewAsync(); return Inside(v.X, v.Y, B1); }, true,
            "map should be centred on object B1");
        Assert.That(await Map.HighlightCountAsync(), Is.EqualTo(1));
    }

    [Test]
    public async Task Clicking_a_linked_object_on_the_map_highlights_its_text()
    {
        var text = await OpenBostaderAsync(admin: false);
        await Map.FitAsync(BostaderExtent);

        await Map.ClickMapAtAsync(B1[0], B1[1]);

        await Expect(text.MapLinks.First).ToHaveClassAsync(new System.Text.RegularExpressions.Regex("o-map-link--active"));
        Assert.That(await Map.HighlightCountAsync(), Is.EqualTo(1));
    }

    [Test]
    public async Task Clicking_an_unlinked_object_highlights_nothing()
    {
        var text = await OpenBostaderAsync(admin: false);
        await Map.FitAsync(BostaderExtent);

        await Map.ClickMapAtAsync(B2[0], B2[1]);
        await Page.WaitForTimeoutAsync(600); // singleclick fires after the double-click delay

        await Expect(text.Content.Locator(".o-map-link--active")).ToHaveCountAsync(0);
        Assert.That(await Map.HighlightCountAsync(), Is.EqualTo(0));
    }

    private static readonly System.Text.RegularExpressions.Regex ActiveLink = new("o-map-link--active");

    [Test]
    public async Task Clicking_an_unlinked_object_or_empty_map_clears_the_selection()
    {
        var text = await OpenBostaderAsync(admin: false);
        await Map.FitAsync(BostaderExtent);
        var active = text.Content.Locator(".o-map-link--active");

        await Map.ClickMapAtAsync(B1[0], B1[1]);
        await Expect(text.MapLinks.First).ToHaveClassAsync(ActiveLink);
        await WaitForValueAsync(() => Map.HighlightCountAsync(), 1, "linked object highlighted");
        await Map.ClearFeatureInfoAsync();

        await Map.ClickMapAtAsync(B2[0], B2[1]);
        await Expect(active).ToHaveCountAsync(0);
        await WaitForValueAsync(() => Map.HighlightCountAsync(), 0, "unlinked object clears the highlight");
        await Map.ClearFeatureInfoAsync();

        await Map.ClickMapAtAsync(B1[0], B1[1]);
        await Expect(text.MapLinks.First).ToHaveClassAsync(ActiveLink);
        await WaitForValueAsync(() => Map.HighlightCountAsync(), 1, "linked object highlighted again");
        await Map.ClearFeatureInfoAsync();

        await Map.ClickMapAtAsync(EmptySpot[0], EmptySpot[1]);
        await Expect(active).ToHaveCountAsync(0);
        await WaitForValueAsync(() => Map.HighlightCountAsync(), 0, "empty map clears the highlight");
    }

    [Test]
    public async Task A_near_miss_on_a_linked_object_keeps_the_selection()
    {
        var text = await OpenBostaderAsync(admin: false);
        await Map.FitAsync(BostaderExtent);
        await Map.ClickMapAtAsync(B1[0], B1[1]);
        await Expect(text.MapLinks.First).ToHaveClassAsync(ActiveLink);
        await Map.ClearFeatureInfoAsync();

        // 3 px outside B1's east edge, within the 5 px hit tolerance.
        var edge = await Map.ScreenPointAsync(B1[0] + 4000, B1[1]);
        await Page.Mouse.ClickAsync((float)edge[0] + 3, (float)edge[1]);
        await Page.WaitForTimeoutAsync(600); // singleclick fires after the double-click delay

        await Expect(text.MapLinks.First).ToHaveClassAsync(ActiveLink);
        Assert.That(await Map.HighlightCountAsync(), Is.EqualTo(1));
    }

    [Test]
    public async Task Clicking_linked_text_clears_the_mark_on_another_link_but_not_on_itself()
    {
        var text = await OpenBostaderAsync(admin: true);
        await text.StartEditingAsync();
        await Map.FitAsync(BostaderExtent);
        await text.SelectLastLineAsync();
        await Map.LinkModal.OpenAsync(text);
        await Map.LinkModal.ChooseAsync(Map.LinkModal.OwnLayerOption);
        await Map.ClickMapAtAsync(B2[0], B2[1]);
        await Expect(text.Status).ToHaveTextAsync("Länkat till objekt B2");
        await text.SaveAndCloseAsync();
        var linkB1 = text.Content.Locator("span[data-feature-id='B1']");
        var linkB2 = text.Content.Locator("span[data-feature-id='B2']");
        // Saving is quick: a map click within 250 ms of the pick click would be a double click.
        await Page.WaitForTimeoutAsync(600);

        // Clicking a link keeps its own mark and the highlight.
        await Map.ClickMapAtAsync(B1[0], B1[1]);
        await Expect(linkB1).ToHaveClassAsync(ActiveLink);
        await linkB1.ClickAsync();
        await Map.WaitForViewToSettleAsync();
        await Expect(linkB1).ToHaveClassAsync(ActiveLink);
        Assert.That(await Map.HighlightCountAsync(), Is.EqualTo(1));

        // Clicking another link removes the mark and moves the highlight.
        await linkB2.ClickAsync();
        await Expect(text.Content.Locator(".o-map-link--active")).ToHaveCountAsync(0);
        await WaitForValueAsync(async () => { var v = await Map.ViewAsync(); return Inside(v.X, v.Y, B2); }, true,
            "map should be centred on object B2");
        Assert.That(await Map.HighlightCountAsync(), Is.EqualTo(1));
    }

    [Test]
    public async Task A_missed_click_in_pick_mode_keeps_the_highlight()
    {
        var text = await OpenBostaderAsync(admin: true);
        await text.StartEditingAsync();
        await Map.FitAsync(BostaderExtent);
        await Map.ClickMapAtAsync(B1[0], B1[1]);
        await WaitForValueAsync(() => Map.HighlightCountAsync(), 1, "linked object highlighted");
        await Map.ClearFeatureInfoAsync();
        await text.SelectLastLineAsync();
        await Map.LinkModal.OpenAsync(text);
        await Map.LinkModal.ChooseAsync(Map.LinkModal.OwnLayerOption);

        await Map.ClickMapAtAsync(EmptySpot[0], EmptySpot[1]);
        await Expect(text.Status).ToHaveTextAsync("Inget objekt i det valda kartlagret här – klicka på ett objekt.");
        await Page.WaitForTimeoutAsync(600); // singleclick fires after the double-click delay

        Assert.That(await Map.HighlightCountAsync(), Is.EqualTo(1));
    }

    [Test]
    public async Task Closing_the_text_panel_clears_the_highlight()
    {
        var text = await OpenBostaderAsync(admin: false);
        await text.MapLinks.First.ClickAsync();
        await WaitForValueAsync(() => Map.HighlightCountAsync(), 1, "highlight shown");

        await text.CloseButton.ClickAsync();

        Assert.That(await Map.HighlightCountAsync(), Is.EqualTo(0));
    }

    // ─── Map link in the first heading ───────────────────────────────────────
    // Test_Kollektivtrafik's h1 links to K1 (no stored extent); Nuläge's h1 is unlinked.

    private static readonly double[] K1Extent = [590000, 6910000, 650000, 6950000];

    private static bool InsideExtent(double x, double y, double[] extent) =>
        x >= extent[0] && x <= extent[2] && y >= extent[1] && y <= extent[3];

    [Test]
    public async Task Opening_a_submenu_with_a_linked_heading_zooms_to_the_object_and_highlights_it()
    {
        await Map.GotoAsync();
        await Map.SetViewAsync(700000, 7050000, 3);

        await Map.OpenLayerAsync("Trafik", "Kollektivtrafik");

        await WaitForValueAsync(() => Map.HighlightCountAsync(), 1, "object K1 highlighted");
        await WaitForValueAsync(async () => { var v = await Map.ViewAsync(); return InsideExtent(v.X, v.Y, K1Extent); }, true,
            "map should be centred on object K1");
        AssertNoJsErrors();
    }

    [Test]
    public async Task Opening_a_submenu_with_an_unlinked_heading_leaves_the_map_alone()
    {
        await Map.GotoAsync();
        await Map.SetViewAsync(700000, 7050000, 3);

        await Map.OpenLayerAsync("Bostäder", "Nuläge");
        await WaitForValueAsync(() => Map.LoadedFeatureCountAsync("Test_Bostader_Nulage"), 2, "fixture features loaded");
        await Page.WaitForTimeoutAsync(600);

        Assert.That(await Map.HighlightCountAsync(), Is.EqualTo(0));
        var v = await Map.ViewAsync();
        Assert.That(Math.Abs(v.X - 700000) < 50 && Math.Abs(v.Y - 7050000) < 50 && Math.Abs(v.Zoom - 3) < 0.01, Is.True,
            "the map view must not move");
    }

    [Test]
    public async Task Switching_quickly_from_a_linked_submenu_leaves_no_stale_highlight()
    {
        // Hold back K1's overlay so the heading link is still waiting for it
        // when the next submenu opens.
        var overlayRequested = new TaskCompletionSource();
        var overlayDelivered = new TaskCompletionSource();
        await Page.RouteAsync("**/content-files/Test_Kollektivtrafik.geojson", async route =>
        {
            overlayRequested.TrySetResult();
            await Task.Delay(1500);
            await route.ContinueAsync();
            overlayDelivered.TrySetResult();
        });
        await Map.GotoAsync();
        await Map.OpenLayerAsync("Trafik", "Kollektivtrafik");
        // The overlay is only requested once the map has rendered the shown layer.
        await overlayRequested.Task.WaitAsync(TimeSpan.FromSeconds(10));

        var text = await Map.OpenLayerAsync("Bostäder", "Nuläge");

        await Expect(text.Content.Locator("h1")).ToHaveTextAsync("Bostäder nuläge");
        await WaitForValueAsync(() => Map.LoadedFeatureCountAsync("Test_Bostader_Nulage"), 2, "fixture features loaded");
        await overlayDelivered.Task.WaitAsync(TimeSpan.FromSeconds(10));
        await Page.WaitForTimeoutAsync(500);
        Assert.That(await Map.HighlightCountAsync(), Is.EqualTo(0));
        Assert.That(await Map.IsLayerVisibleAsync("Test_Kollektivtrafik"), Is.False);
        AssertNoJsErrors();
    }

    [Test]
    public async Task Highlight_layer_is_titled_in_the_layer_control()
    {
        await Map.GotoAsync();
        await Map.OpenLayerAsync("Trafik", "Kollektivtrafik");
        await WaitForValueAsync(() => Map.HighlightCountAsync(), 1, "highlight shown");

        var legend = Page.Locator(".o-legend");
        await Expect(legend).ToContainTextAsync("Selekterat objekt");
        await Expect(legend).Not.ToContainTextAsync("Titel saknas");
    }

    [Test]
    public async Task Closing_the_text_panel_clears_the_heading_link_highlight()
    {
        await Map.GotoAsync();
        var text = await Map.OpenLayerAsync("Trafik", "Kollektivtrafik");
        await WaitForValueAsync(() => Map.HighlightCountAsync(), 1, "highlight shown");

        await text.CloseButton.ClickAsync();

        Assert.That(await Map.HighlightCountAsync(), Is.EqualTo(0));
    }

    // ─── Zoom to a linked object ─────────────────────────────────────────────
    // Same values as the constants at the top of src/featureSync.js.

    private const double PointResolution = 2;
    private const double FitMinResolution = 0.5;
    private const double FitPaddingPx = 100;
    private static readonly double[] K2 = [618000, 6921000];

    /// <summary>
    /// Links the last line of Kollektivtrafik's text to point K2, saves and
    /// returns the link. The stored extent has zero size.
    /// </summary>
    private async Task<ILocator> LinkTextToPointK2Async()
    {
        var map = await OpenAsAdminAsync();
        var text = await map.OpenLayerAsync("Trafik", "Kollektivtrafik");
        await WaitForValueAsync(() => Map.HighlightCountAsync(), 1, "heading link focused");
        await text.StartEditingAsync();
        await Map.FitAsync([K2[0] - 2000, K2[1] - 2000, K2[0] + 2000, K2[1] + 2000]);
        await text.SelectLastLineAsync();
        await Map.LinkModal.OpenAsync(text);
        await Map.LinkModal.ChooseAsync(Map.LinkModal.OwnLayerOption);
        await Map.ClickMapAtAsync(K2[0], K2[1]);
        await Expect(text.Status).ToHaveTextAsync("Länkat till objekt K2");
        await text.SaveAndCloseAsync();

        var link = text.Content.Locator("span[data-feature-id='K2']");
        var extent = (await link.GetAttributeAsync("data-extent"))!.Split(',');
        Assert.That(extent[0], Is.EqualTo(extent[2]), "a point has no width");
        Assert.That(extent[1], Is.EqualTo(extent[3]), "a point has no height");
        return link;
    }

    private async Task AssertCentredOnK2AtPointResolutionAsync()
    {
        await Map.WaitForViewToSettleAsync();
        Assert.That(await Map.ResolutionAsync(), Is.EqualTo(PointResolution).Within(0.01));
        var v = await Map.ViewAsync();
        Assert.That(Inside(v.X, v.Y, K2, 50), Is.True, "map should be centred on point K2");
    }

    [Test]
    public async Task Linked_point_is_centred_at_the_point_resolution()
    {
        var link = await LinkTextToPointK2Async();
        await Map.SetViewAsync(700000, 7050000, 3);

        await link.ClickAsync();

        await AssertCentredOnK2AtPointResolutionAsync();
        Assert.That(await Map.HighlightCountAsync(), Is.EqualTo(1));
    }

    [Test]
    public async Task Linked_point_not_yet_loaded_zooms_the_same_from_its_stored_extent()
    {
        var link = await LinkTextToPointK2Async();
        var release = new TaskCompletionSource();
        await Page.RouteAsync("**/content-files/Test_Kollektivtrafik.geojson", async route =>
        {
            await release.Task;
            await route.ContinueAsync();
        });
        await Map.GotoAsync();
        // Origo's zoom-to-home on start (zoomOnStart, 1 s) would override the link's zoom.
        await Map.WaitForViewToSettleAsync();
        await Map.OpenLayerAsync("Trafik", "Kollektivtrafik");

        await link.ClickAsync();

        await AssertCentredOnK2AtPointResolutionAsync();
        Assert.That(await Map.HighlightCountAsync(), Is.EqualTo(0), "the feature is still loading");

        release.TrySetResult();

        await WaitForValueAsync(() => Map.HighlightCountAsync(), 1, "highlighted once loaded");
        await AssertCentredOnK2AtPointResolutionAsync();
    }

    [Test]
    public async Task Linked_polygon_is_fitted_with_a_margin()
    {
        var text = await OpenBostaderAsync(admin: false);
        await Map.SetViewAsync(700000, 7050000, 3);

        await text.MapLinks.First.ClickAsync();
        await Map.WaitForViewToSettleAsync();

        // The fit is limited by one axis, which gets the padding on both sides.
        Assert.That(await Map.ExtentMarginAsync([B1[0] - 4000, B1[1] - 4000, B1[0] + 4000, B1[1] + 4000]),
            Is.EqualTo(FitPaddingPx).Within(2));
    }

    [Test]
    public async Task Linked_small_polygon_stops_at_the_minimum_resolution()
    {
        var text = await OpenBostaderAsync(admin: false);
        // Shrink B1 to ±4 m: fitting it unlimited would go far below the limit.
        await Page.EvaluateAsync(
            "() => origo.api().getLayer('Test_Bostader_Nulage').getSource().getFeatureById('B1').getGeometry().scale(0.001)");
        await Map.SetViewAsync(700000, 7050000, 3);

        await text.MapLinks.First.ClickAsync();
        await Map.WaitForViewToSettleAsync();

        // The view's own limit applies when it is stricter than ours.
        var expected = Math.Max(FitMinResolution, await Map.MinResolutionAsync());
        Assert.That(await Map.ResolutionAsync(), Is.EqualTo(expected).Within(0.01));
    }

    // ─── "Koppla till karta" dialog ──────────────────────────────────────────

    [Test]
    public async Task Dialog_without_selected_text_only_allows_cancel()
    {
        var text = await OpenBostaderAsync(admin: true);
        await text.StartEditingAsync();
        await text.MoveCursorToEndAsync();

        await Map.LinkModal.OpenAsync(text);

        await Expect(Map.LinkModal.Warning).ToHaveTextAsync("Markera först den text som ska kopplas till kartan.");
        await Expect(Map.LinkModal.OwnLayerOption).ToBeDisabledAsync();
        await Expect(Map.LinkModal.MapViewOption).ToBeDisabledAsync();
        await Expect(Map.LinkModal.RemoveButton).ToBeDisabledAsync();
        await Map.LinkModal.ChooseAsync(Map.LinkModal.CancelButton);
    }

    [Test]
    public async Task Dialog_closes_on_backdrop_click()
    {
        var text = await OpenBostaderAsync(admin: true);
        await text.StartEditingAsync();
        await Map.LinkModal.OpenAsync(text);

        await Map.LinkModal.Root.ClickAsync(new() { Position = new() { X = 5, Y = 5 } });

        await Expect(Map.LinkModal.Root).ToHaveCountAsync(0);
    }

    [Test]
    public async Task Text_can_be_linked_to_an_object_in_the_submenus_own_layer()
    {
        var text = await OpenBostaderAsync(admin: true);
        await text.StartEditingAsync();
        await Map.FitAsync(BostaderExtent);
        await text.SelectLastLineAsync();

        await Map.LinkModal.OpenAsync(text);
        await Map.LinkModal.ChooseAsync(Map.LinkModal.OwnLayerOption);
        await Expect(text.Status).ToHaveTextAsync("Klicka på ett objekt i kartan för att länka...");
        await Map.ClickMapAtAsync(B2[0], B2[1]);

        await Expect(text.Status).ToHaveTextAsync("Länkat till objekt B2");
        var link = text.Content.Locator("span[data-feature-id='B2']");
        await Expect(link).ToHaveTextAsync("Sista stycket.");
        await Expect(link).ToHaveAttributeAsync("data-layer-name", "Test_Bostader_Nulage");
        // The stored extent is in map projection; it must cover object B2.
        var extent = await link.GetAttributeAsync("data-extent");
        Assert.That(extent, Does.Match(@"^-?\d+,-?\d+,-?\d+,-?\d+$"));
        Assert.That(await Map.MapExtentContainsAsync(extent!, B2[0], B2[1]), Is.True);

        await text.SaveAsync();
        var saved = (await ApiGetJsonAsync("/api/content/Test_Bostader_Nulage")).GetRawText();
        Assert.That(saved, Does.Contain("\"featureId\": \"B2\""));
    }

    [Test]
    public async Task Picking_empty_map_keeps_waiting_for_an_object()
    {
        var text = await OpenBostaderAsync(admin: true);
        await text.StartEditingAsync();
        await Map.FitAsync(BostaderExtent);
        await text.SelectLastLineAsync();
        await Map.LinkModal.OpenAsync(text);
        await Map.LinkModal.ChooseAsync(Map.LinkModal.OwnLayerOption);

        await Map.ClickMapAtAsync(EmptySpot[0], EmptySpot[1]);
        await Expect(text.Status).ToHaveTextAsync("Inget objekt i det valda kartlagret här – klicka på ett objekt.");

        await Map.ClickMapAtAsync(B2[0], B2[1]);
        await Expect(text.Status).ToHaveTextAsync("Länkat till objekt B2");
    }

    [Test]
    public async Task Text_can_be_linked_to_the_current_map_view_and_restores_it()
    {
        var text = await OpenBostaderAsync(admin: true);
        await text.StartEditingAsync();
        await Map.SetViewAsync(640000, 6960000, 5);
        await text.SelectLastLineAsync();

        await Map.LinkModal.OpenAsync(text);
        await Map.LinkModal.ChooseAsync(Map.LinkModal.MapViewOption);

        await Expect(text.Status).ToHaveTextAsync("Länkat till nuvarande kartvy.");
        await Expect(text.MapViewLinks).ToHaveCountAsync(1);
        await Expect(text.MapViewLinks).ToHaveAttributeAsync("data-map-state", new System.Text.RegularExpressions.Regex("."));
        await text.SaveAsync();

        await Map.SetViewAsync(580000, 6880000, 2);
        await text.MapViewLinks.ClickAsync();

        await WaitForValueAsync(async () =>
        {
            var v = await Map.ViewAsync();
            return Math.Abs(v.X - 640000) < 50 && Math.Abs(v.Y - 6960000) < 50 && Math.Abs(v.Zoom - 5) < 0.01;
        }, true, "the saved map view should be restored");
    }

    [Test]
    public async Task Map_links_can_be_removed()
    {
        var text = await OpenBostaderAsync(admin: true);
        await text.StartEditingAsync();
        await text.SelectParagraphAsync(0);

        await Map.LinkModal.OpenAsync(text);
        await Map.LinkModal.ChooseAsync(Map.LinkModal.RemoveButton);

        await Expect(text.Status).ToHaveTextAsync("Kartkopplingar borttagna.");
        await Expect(text.MapLinks).ToHaveCountAsync(0);
        await text.SaveAsync();
        var saved = (await ApiGetJsonAsync("/api/content/Test_Bostader_Nulage")).GetRawText();
        Assert.That(saved, Does.Not.Contain("mapFeatureLink"));
        Assert.That(saved, Does.Contain("centrumområdet"), "the text itself must stay");
    }

    // ─── Objects in Origo map layers (WFS, mocked) ───────────────────────────

    private const string WfsHost = "http://wfs.example.test/";
    private static readonly double[] WfsCenter = [645000, 6955000];

    /// <summary>
    /// Answers every WFS request to the example GeoServer with one polygon, in
    /// the CRS the request asks for (srsname) — EPSG:3006 or the map projection.
    /// Must be called after the page has loaded (uses Origo for the conversion).
    /// </summary>
    private async Task MockExampleWfsAsync(List<string>? requests = null)
    {
        double[][] ring =
        [
            [WfsCenter[0] - 3000, WfsCenter[1] - 3000], [WfsCenter[0] + 3000, WfsCenter[1] - 3000],
            [WfsCenter[0] + 3000, WfsCenter[1] + 3000], [WfsCenter[0] - 3000, WfsCenter[1] + 3000],
            [WfsCenter[0] - 3000, WfsCenter[1] - 3000]
        ];
        var ringInMapProjection = await Map.ToMapProjectionAsync(ring);

        static string Body(double[][] coords) => JsonSerializer.Serialize(new
        {
            type = "FeatureCollection",
            features = new[] { new { type = "Feature", id = "kommunyta.1", properties = new { namn = "Testkommun" }, geometry = new { type = "Polygon", coordinates = new[] { coords } } } }
        });

        await Page.RouteAsync($"{WfsHost}**", async route =>
        {
            requests?.Add(route.Request.Url);
            var url = Uri.UnescapeDataString(route.Request.Url);
            var body = url.Contains("srsname=EPSG:3006", StringComparison.OrdinalIgnoreCase) || url.Contains("srsName=EPSG:3006")
                ? Body(ring)
                : Body(ringInMapProjection);
            await route.FulfillAsync(new() { Status = 200, ContentType = "application/json", Body = body });
        });
    }

    [Test]
    public async Task Text_can_be_linked_to_an_object_in_a_wfs_map_layer()
    {
        var requests = new List<string>();
        var text = await OpenBostaderAsync(admin: true);
        await MockExampleWfsAsync(requests);
        await Map.SetLayerVisibleAsync("example-kommunyta", true);
        await text.StartEditingAsync();
        await text.SelectLastLineAsync();

        await Map.LinkModal.OpenAsync(text);
        await Expect(Map.LinkModal.LayerSelect.Locator("option[value='example-kommunyta']")).ToHaveTextAsync("Exempel kommunyta");
        await Map.LinkModal.LayerSelect.SelectOptionAsync("example-kommunyta");
        await Map.LinkModal.ChooseAsync(Map.LinkModal.PickFromLayerButton);

        await Map.FitAsync([WfsCenter[0] - 6000, WfsCenter[1] - 6000, WfsCenter[0] + 6000, WfsCenter[1] + 6000]);
        await WaitForValueAsync(() => Map.LoadedFeatureCountAsync("example-kommunyta"), 1, "mocked WFS feature loaded");
        await Map.ClickMapAtAsync(WfsCenter[0], WfsCenter[1]);

        await Expect(text.Status).ToHaveTextAsync("Länkat till objekt kommunyta.1");
        var link = text.Content.Locator("span[data-feature-id='kommunyta.1']");
        await Expect(link).ToHaveAttributeAsync("data-layer-name", "example-kommunyta");
        Assert.That(requests, Has.Some.Contains("request=GetFeature"));
    }

    [Test]
    public async Task Link_to_a_wfs_object_zooms_and_highlights_it()
    {
        var text = await OpenBostaderAsync(admin: true);
        await MockExampleWfsAsync();
        await Map.SetLayerVisibleAsync("example-kommunyta", true);
        await text.StartEditingAsync();
        await text.SelectLastLineAsync();
        await Map.LinkModal.OpenAsync(text);
        await Map.LinkModal.LayerSelect.SelectOptionAsync("example-kommunyta");
        await Map.LinkModal.ChooseAsync(Map.LinkModal.PickFromLayerButton);
        await Map.FitAsync([WfsCenter[0] - 6000, WfsCenter[1] - 6000, WfsCenter[0] + 6000, WfsCenter[1] + 6000]);
        await WaitForValueAsync(() => Map.LoadedFeatureCountAsync("example-kommunyta"), 1, "mocked WFS feature loaded");
        await Map.ClickMapAtAsync(WfsCenter[0], WfsCenter[1]);
        await Expect(text.Status).ToHaveTextAsync("Länkat till objekt kommunyta.1");
        await text.SaveAsync();

        await Map.SetViewAsync(580000, 6880000, 2);
        await Map.SetLayerVisibleAsync("example-kommunyta", false);
        await text.Content.Locator("span[data-feature-id='kommunyta.1']").ClickAsync();

        await WaitForValueAsync(async () => { var v = await Map.ViewAsync(); return Inside(v.X, v.Y, WfsCenter, 3000); }, true,
            "map should be centred on the WFS object");
        Assert.That(await Map.IsLayerVisibleAsync("example-kommunyta"), Is.True, "the layer is turned on again");
        Assert.That(await Map.HighlightCountAsync(), Is.EqualTo(1));
    }

    [Test]
    public async Task Layer_list_is_empty_when_no_map_layer_has_objects()
    {
        var text = await OpenBostaderAsync(admin: true);
        await text.StartEditingAsync();
        await text.SelectLastLineAsync();

        await Map.LinkModal.OpenAsync(text);

        await Expect(Map.LinkModal.LayerSelect).ToBeDisabledAsync();
        await Expect(Map.LinkModal.LayerSelect.Locator("option")).ToHaveTextAsync("Inga kartlager med objekt finns");
        await Expect(Map.LinkModal.PickFromLayerButton).ToBeDisabledAsync();
    }
}
