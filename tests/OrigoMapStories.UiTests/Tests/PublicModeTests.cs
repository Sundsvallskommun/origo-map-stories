using OrigoMapStories.UiTests.Infrastructure;

namespace OrigoMapStories.UiTests.Tests;

/// <summary>The public link (no ?admin): browsing menus, texts and map layers.</summary>
public class PublicModeTests : UiTestBase
{
    [Test]
    public async Task Page_loads_without_javascript_errors()
    {
        await Map.GotoAsync();
        await Map.OpenLayerPanelAsync();
        await Map.OpenLayerAsync("Bostäder", "Nuläge");

        AssertNoJsErrors();
    }

    [Test]
    public async Task Layer_panel_shows_menus_from_site_config()
    {
        await Map.GotoAsync();
        var panel = await Map.OpenLayerPanelAsync();

        await Expect(panel.Title).ToHaveTextAsync("Testkarta");
        Assert.That(await panel.SectionLabelsAsync(), Is.EqualTo(new[] { "Bostäder", "Trafik" }));
        Assert.That(await panel.ItemLabelsAsync("Bostäder"), Is.EqualTo(new[] { "Nuläge", "Framtid 2040" }));
        Assert.That(await panel.ItemLabelsAsync("Trafik"), Is.EqualTo(new[] { "Kollektivtrafik" }));
    }

    [Test]
    public async Task Header_image_from_site_config_is_shown()
    {
        await Map.GotoAsync();
        var panel = await Map.OpenLayerPanelAsync();

        await Expect(panel.Hero).ToHaveAttributeAsync("style", new System.Text.RegularExpressions.Regex("site-assets/header-image\\.png"));
    }

    [Test]
    public async Task Selecting_a_submenu_shows_its_text_and_turns_on_its_layer()
    {
        await Map.GotoAsync();
        var text = await Map.OpenLayerAsync("Bostäder", "Nuläge");

        await Expect(text.Title).ToHaveTextAsync("Bostäder – Nuläge");
        await Expect(text.Content.Locator("h1")).ToHaveTextAsync("Bostäder nuläge");
        await Expect(text.MapLinks).ToHaveCountAsync(1);
        await Expect(text.Images).ToHaveCountAsync(1);
        Assert.That(await Map.IsLayerVisibleAsync("Test_Bostader_Nulage"), Is.True);
        Assert.That(await Map.IsLayerVisibleAsync("Test_Kollektivtrafik"), Is.False);
    }

    [Test]
    public async Task Switching_submenu_switches_layer_and_text()
    {
        await Map.GotoAsync();
        await Map.OpenLayerAsync("Bostäder", "Nuläge");
        var text = await Map.OpenLayerAsync("Trafik", "Kollektivtrafik");

        await Expect(text.Content.Locator("h1")).ToHaveTextAsync("Kollektivtrafik");
        Assert.That(await Map.IsLayerVisibleAsync("Test_Kollektivtrafik"), Is.True);
        Assert.That(await Map.IsLayerVisibleAsync("Test_Bostader_Nulage"), Is.False);
    }

    [Test]
    public async Task Submenu_without_text_shows_placeholder()
    {
        await Map.GotoAsync();
        var text = await Map.OpenLayerAsync("Bostäder", "Framtid 2040");

        await Expect(text.Content.Locator("h1")).ToHaveTextAsync("Välkommen till kartinnehållet");
    }

    [Test]
    public async Task Text_image_is_served_from_the_current_version()
    {
        await Map.GotoAsync();
        var text = await Map.OpenLayerAsync("Bostäder", "Nuläge");

        var loaded = await text.Images.First.EvaluateAsync<bool>("img => img.complete && img.naturalWidth === 64");
        Assert.That(loaded, Is.True, "fixture image should load (64 px wide)");
    }

    [Test]
    public async Task Closing_the_text_panel_hides_the_layer()
    {
        await Map.GotoAsync();
        var text = await Map.OpenLayerAsync("Bostäder", "Nuläge");

        await text.CloseButton.ClickAsync();

        await Expect(text.Root).ToBeHiddenAsync();
        Assert.That(await Map.IsLayerVisibleAsync("Test_Bostader_Nulage"), Is.False);
    }

    [Test]
    public async Task No_admin_controls_on_public_link_even_with_a_valid_token()
    {
        var token = await GetAdminTokenAsync();
        await Page.GotoAsync("/");
        await Page.EvaluateAsync("t => localStorage.setItem('cms_token', t)", token);

        await Map.GotoAsync();
        var panel = await Map.OpenLayerPanelAsync();
        await Expect(panel.SettingsButton).ToHaveCountAsync(0);

        var text = await Map.OpenLayerAsync("Bostäder", "Nuläge");
        await Expect(text.EditButton).ToBeHiddenAsync();
        await Expect(text.MapEditorButton).ToBeHiddenAsync();
        await Expect(Map.Login.Root).ToHaveCountAsync(0);
    }
}
