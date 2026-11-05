using OrigoMapStories.UiTests.Infrastructure;

namespace OrigoMapStories.UiTests.Tests;

/// <summary>
/// The app on a phone (390×844, touch). Tests marked KnownIssue describe how
/// the layout should behave but fails today: the layer panel and text panel
/// sit side by side (211 + 241 px), the map gets no width at all and the text
/// panel is cut off at the right edge. Remove the Ignore when the phone layout
/// has been designed.
/// </summary>
public class PhoneLayoutTests : UiTestBase
{
    private const int Width = 390;
    private const string KnownIssue = "Känd brist: ingen mobillayout – kartan får 0 px bredd och textpanelen klipps när båda panelerna är öppna.";

    public override BrowserNewContextOptions ContextOptions()
    {
        var options = base.ContextOptions();
        options.ViewportSize = new ViewportSize { Width = Width, Height = 844 };
        options.IsMobile = true;
        options.HasTouch = true;
        return options;
    }

    private async Task<(double Left, double Width)> BoxAsync(ILocator locator)
    {
        var box = await locator.BoundingBoxAsync() ?? throw new InvalidOperationException("element has no box");
        return (box.X, box.Width);
    }


    [Test]
    public async Task Map_and_plugin_button_are_usable_on_a_phone()
    {
        await Map.GotoAsync();

        await Expect(Map.PluginButton).ToBeVisibleAsync();
        var mapWidth = await Page.EvaluateAsync<double>("() => origo.api().getMap().getSize()[0]");
        Assert.That(mapWidth, Is.EqualTo(Width).Within(2));
        Assert.That(await Page.EvaluateAsync<int>("() => document.documentElement.scrollWidth"), Is.LessThanOrEqualTo(Width));
    }

    [Test]
    public async Task Layer_panel_fits_on_a_phone_and_submenus_can_be_tapped()
    {
        await Map.GotoAsync();
        await Map.PluginButton.TapAsync();
        await Expect(Map.LayerPanel.Root).ToBeVisibleAsync();

        var (left, width) = await BoxAsync(Map.LayerPanel.Root);
        Assert.That(left + width, Is.LessThanOrEqualTo(Width));

        await Map.LayerPanel.Section("Bostäder").TapAsync();
        await Map.LayerPanel.Item("Bostäder", "Nuläge").TapAsync();
        await Expect(Map.TextPanel.Content.Locator("h1")).ToHaveTextAsync("Bostäder nuläge");
    }

    [Test]
    public async Task Next_arrow_can_be_tapped_on_a_phone()
    {
        await Map.GotoAsync();
        await Map.PluginButton.TapAsync();
        await Map.LayerPanel.Section("Bostäder").TapAsync();
        await Map.LayerPanel.Item("Bostäder", "Nuläge").TapAsync();
        await Map.TextPanel.WaitForContentAsync();

        await Map.TextPanel.NextButton.TapAsync();

        await Expect(Map.TextPanel.Title).ToHaveTextAsync("Bostäder – Framtid 2040");
        await Expect(Map.LayerPanel.Item("Bostäder", "Framtid 2040")).ToHaveClassAsync(new System.Text.RegularExpressions.Regex("is-active"));
    }

    [Test]
    public async Task Editor_toolbar_stays_visible_when_scrolling_on_a_phone()
    {
        var map = await OpenAsAdminAsync();
        var text = await map.OpenLayerAsync("Bostäder", "Nuläge");
        await text.StartEditingAsync();

        await text.AssertToolbarStaysUsableAtBottomAsync();
    }

    [Test]
    public async Task Text_editor_buttons_wrap_inside_the_text_panel_on_a_phone()
    {
        var map = await OpenAsAdminAsync();
        var text = await map.OpenLayerAsync("Bostäder", "Nuläge");
        await text.StartEditingAsync();

        var (panelLeft, panelWidth) = await BoxAsync(text.Root);
        foreach (var button in new[] { text.CancelButton, text.SaveButton, text.SaveAndCloseButton })
        {
            await Expect(button).ToBeVisibleAsync();
            var (left, width) = await BoxAsync(button);
            Assert.That(left, Is.GreaterThanOrEqualTo(panelLeft - 1));
            Assert.That(left + width, Is.LessThanOrEqualTo(panelLeft + panelWidth + 1), "button inside the text panel");
        }
    }

    [Test]
    public async Task Map_editor_buttons_fit_on_a_phone()
    {
        var map = await OpenAsAdminAsync();
        var text = await map.OpenLayerAsync("Bostäder", "Nuläge");
        await text.MapEditorButton.TapAsync();
        await map.MapEditor.WaitForLoadedAsync();

        foreach (var button in new[] { map.MapEditor.CloseButton, map.MapEditor.SaveButton, map.MapEditor.SaveAndCloseButton })
        {
            var (left, width) = await BoxAsync(button);
            Assert.That(left, Is.GreaterThanOrEqualTo(0));
            Assert.That(left + width, Is.LessThanOrEqualTo(Width), "button inside the screen");
        }
    }

    [Test]
    public async Task Site_config_buttons_fit_on_a_phone()
    {
        var map = await OpenAsAdminAsync();
        await map.PluginButton.TapAsync();
        await map.SiteConfig.OpenAsync(map.LayerPanel);

        foreach (var button in new[] { map.SiteConfig.CancelButton, map.SiteConfig.SaveButton, map.SiteConfig.SaveAndCloseButton })
        {
            await Expect(button).ToBeVisibleAsync();
            var (left, width) = await BoxAsync(button);
            Assert.That(left, Is.GreaterThanOrEqualTo(0));
            Assert.That(left + width, Is.LessThanOrEqualTo(Width), "button inside the screen");
        }
    }

    [Test]
    [Ignore(KnownIssue)]
    public async Task Text_panel_is_fully_visible_on_a_phone()
    {
        await Map.GotoAsync();
        await Map.PluginButton.TapAsync();
        await Map.LayerPanel.Section("Bostäder").TapAsync();
        await Map.LayerPanel.Item("Bostäder", "Nuläge").TapAsync();
        await Map.TextPanel.WaitForContentAsync();

        var (left, width) = await BoxAsync(Map.TextPanel.Root);
        Assert.That(left + width, Is.LessThanOrEqualTo(Width), "text panel must not be cut off");
        await Expect(Map.TextPanel.CloseButton).ToBeInViewportAsync();
    }

    [Test]
    [Ignore(KnownIssue)]
    public async Task Map_stays_visible_when_a_submenu_is_open_on_a_phone()
    {
        await Map.GotoAsync();
        await Map.PluginButton.TapAsync();
        await Map.LayerPanel.Section("Bostäder").TapAsync();
        await Map.LayerPanel.Item("Bostäder", "Nuläge").TapAsync();
        await Map.TextPanel.WaitForContentAsync();

        var mapWidth = await Page.EvaluateAsync<double>("() => origo.api().getMap().getSize()[0]");
        Assert.That(mapWidth, Is.GreaterThan(0), "the map must not collapse to zero width");
    }

    [Test]
    [Ignore(KnownIssue + " Med 0 px karta laddas lagret aldrig.")]
    public async Task Opening_a_submenu_with_a_linked_heading_highlights_the_object_on_a_phone()
    {
        await Map.GotoAsync();
        await Map.PluginButton.TapAsync();
        await Map.LayerPanel.Section("Trafik").TapAsync();
        await Map.LayerPanel.Item("Trafik", "Kollektivtrafik").TapAsync();
        await Map.TextPanel.WaitForContentAsync();

        await WaitForValueAsync(() => Map.HighlightCountAsync(), 1, "object highlighted when the submenu opens");
    }

    [Test]
    [Ignore(KnownIssue + " Med 0 px karta laddas lagret aldrig.")]
    public async Task Linked_text_can_be_tapped_on_a_phone()
    {
        await Map.GotoAsync();
        await Map.PluginButton.TapAsync();
        await Map.LayerPanel.Section("Bostäder").TapAsync();
        await Map.LayerPanel.Item("Bostäder", "Nuläge").TapAsync();
        await WaitForValueAsync(() => Map.LoadedFeatureCountAsync("Test_Bostader_Nulage"), 2, "fixture features loaded");

        await Map.TextPanel.MapLinks.First.TapAsync(new() { Force = true });

        await WaitForValueAsync(() => Map.HighlightCountAsync(), 1, "object highlighted after tapping the link");
    }
}
