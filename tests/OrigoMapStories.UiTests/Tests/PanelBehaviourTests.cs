using System.Text.RegularExpressions;
using OrigoMapStories.UiTests.Infrastructure;

namespace OrigoMapStories.UiTests.Tests;

/// <summary>Smaller panel behaviours: the plugin button state, toggling submenus, defaults and missing data.</summary>
public class PanelBehaviourTests : UiTestBase
{
    private static readonly Regex Disabled = new(@"\bdisabled\b");

    [Test]
    public async Task Plugin_button_is_disabled_while_a_panel_is_open()
    {
        await Map.GotoAsync();
        await Expect(Map.PluginButton).Not.ToHaveClassAsync(Disabled);

        var panel = await Map.OpenLayerPanelAsync();
        await Expect(Map.PluginButton).ToHaveClassAsync(Disabled);

        // Clicking it again does not open a second panel.
        await Map.PluginButton.ClickAsync(new() { Force = true });
        await Expect(Page.Locator("#o-layer-panel")).ToHaveCountAsync(1);

        await panel.CloseButton.ClickAsync();
        await Expect(panel.Root).ToHaveCountAsync(0);
        await Expect(Map.PluginButton).Not.ToHaveClassAsync(Disabled);
    }

    [Test]
    public async Task Closing_the_layer_panel_closes_the_text_panel_and_hides_the_layer()
    {
        await Map.GotoAsync();
        var text = await Map.OpenLayerAsync("Bostäder", "Nuläge");

        await Map.LayerPanel.CloseButton.ClickAsync();

        await Expect(text.Root).ToHaveCountAsync(0);
        Assert.That(await Map.IsLayerVisibleAsync("Test_Bostader_Nulage"), Is.False);
        await Expect(Map.PluginButton).Not.ToHaveClassAsync(Disabled);
    }

    [Test]
    public async Task Collapsing_the_active_section_closes_the_text_and_hides_the_layer()
    {
        await Map.GotoAsync();
        var text = await Map.OpenLayerAsync("Bostäder", "Nuläge");

        await Map.LayerPanel.Section("Bostäder").ClickAsync();

        await Expect(Map.LayerPanel.Section("Bostäder")).ToHaveAttributeAsync("aria-expanded", "false");
        await Expect(text.Root).ToHaveCountAsync(0);
        Assert.That(await Map.IsLayerVisibleAsync("Test_Bostader_Nulage"), Is.False);
    }

    [Test]
    public async Task Collapsing_another_section_keeps_the_active_submenu()
    {
        await Map.GotoAsync();
        var text = await Map.OpenLayerAsync("Bostäder", "Nuläge");
        await Map.LayerPanel.ExpandAsync("Trafik");

        await Map.LayerPanel.Section("Trafik").ClickAsync();

        await Expect(text.Root).ToBeVisibleAsync();
        Assert.That(await Map.IsLayerVisibleAsync("Test_Bostader_Nulage"), Is.True);
    }

    [Test]
    public async Task Clicking_the_active_submenu_again_deselects_it()
    {
        await Map.GotoAsync();
        var text = await Map.OpenLayerAsync("Bostäder", "Nuläge");

        await Map.LayerPanel.Item("Bostäder", "Nuläge").ClickAsync();

        await Expect(Map.LayerPanel.Item("Bostäder", "Nuläge")).Not.ToHaveClassAsync(new Regex("is-active"));
        await Expect(text.Root).ToHaveCountAsync(0);
        Assert.That(await Map.IsLayerVisibleAsync("Test_Bostader_Nulage"), Is.False);
    }

    [Test]
    public async Task Selected_submenu_shows_layer_status()
    {
        await Map.GotoAsync();
        await Map.OpenLayerAsync("Bostäder", "Nuläge");

        await Expect(Map.LayerPanel.Status).ToHaveTextAsync("Valt lager visas i kartan.");
    }

    [Test]
    public async Task Submenu_whose_overlay_is_missing_reports_it()
    {
        await TestDatabase.RemoveCurrentFileAsync("layers/Test_Bostader_Framtid/overlay.geojson");
        await Map.GotoAsync();

        await Map.OpenLayerAsync("Bostäder", "Framtid 2040");

        await Expect(Map.LayerPanel.Status).ToHaveTextAsync("Lagret \"Test_Bostader_Framtid\" är inte laddat.");
    }

    [Test]
    public async Task Without_site_config_a_menu_of_the_catalog_layers_and_the_default_header_are_used()
    {
        await TestDatabase.RemoveCurrentFileAsync("site-config.json");
        await Map.GotoAsync();
        var panel = await Map.OpenLayerPanelAsync();

        await Expect(panel.Title).ToHaveTextAsync("Rubriktext");
        var sections = await panel.SectionLabelsAsync();
        Assert.That(sections, Is.EqualTo(new[] { "Innehåll" }), "no built-in menus; one generated menu lists the catalog");
        Assert.That(await panel.ItemLabelsAsync("Innehåll"), Does.Contain("Test Bostader Nulage").And.Contain("Test Kollektivtrafik"));
    }

    [Test]
    public async Task Empty_header_text_falls_back_to_the_default()
    {
        var map = await OpenAsAdminAsync();
        var panel = await map.OpenLayerPanelAsync();
        await map.SiteConfig.OpenAsync(panel);
        await map.SiteConfig.SelectTabAsync("profil");
        await map.SiteConfig.HeaderText.FillAsync("");
        await map.SiteConfig.SaveAsync();
        await map.SiteConfig.CloseAsync();

        await Expect(map.LayerPanel.Title).ToHaveTextAsync("Rubriktext");
    }

    [Test]
    public async Task Without_header_text_the_page_title_is_the_default()
    {
        await TestDatabase.RemoveCurrentFileAsync("site-config.json");
        await Map.GotoAsync();
        await Map.OpenLayerPanelAsync();

        await Expect(Page).ToHaveTitleAsync("Rubriktext");
    }

    [Test]
    public async Task Page_title_follows_the_saved_header_text()
    {
        var map = await OpenAsAdminAsync();
        var panel = await map.OpenLayerPanelAsync();
        await Expect(Page).ToHaveTitleAsync("Testkarta");

        await map.SiteConfig.OpenAsync(panel);
        await map.SiteConfig.SelectTabAsync("profil");
        await map.SiteConfig.HeaderText.FillAsync("  Ny flikrubrik  ");
        await map.SiteConfig.SaveAsync();

        await Expect(Page).ToHaveTitleAsync("Ny flikrubrik");
        await map.SiteConfig.CloseAsync();
        await Expect(Page).ToHaveTitleAsync("Ny flikrubrik");
    }

    [Test]
    public async Task Corner_logo_and_button_icon_come_from_the_site_config()
    {
        await Map.GotoAsync();

        await Expect(Page.Locator(".o-mapstories-corner-logo")).ToHaveAttributeAsync("src", new Regex("/content-files/site-assets/corner-logo\\.png$"));
        await Expect(Page.Locator(".o-mapstories-button-icon")).ToHaveAttributeAsync("src", new Regex("/content-files/site-assets/button-icon\\.png$"));
        var logoLoaded = await Page.Locator(".o-mapstories-corner-logo").EvaluateAsync<bool>("img => img.complete && img.naturalWidth === 240");
        Assert.That(logoLoaded, Is.True);
    }

    [Test]
    public async Task Without_configured_images_the_neutral_images_from_the_plugin_folder_are_shown()
    {
        await Page.RouteAsync("**/api/site-config", route =>
            route.FulfillAsync(new() { Status = 200, ContentType = "application/json", Body = "{\"headerText\":\"Testkarta\",\"menus\":[]}" }));
        await Map.GotoAsync();

        var icon = Page.Locator(".o-mapstories-button-icon");
        var logo = Page.Locator(".o-mapstories-corner-logo");
        await Expect(icon).ToHaveAttributeAsync("src", new Regex(@"/plugins/img/button-icon\.png$"));
        await Expect(logo).ToHaveAttributeAsync("src", new Regex(@"/plugins/img/corner-logo\.png$"));
        await Expect(logo).ToHaveAttributeAsync("alt", "Testkarta");
        await WaitForValueAsync(() => icon.EvaluateAsync<bool>("img => img.complete && img.naturalWidth > 0"), true, "button icon loads");
        await WaitForValueAsync(() => logo.EvaluateAsync<bool>("img => img.complete && img.naturalWidth > 0"), true, "corner logo loads");

        var panel = await Map.OpenLayerPanelAsync();
        var hero = await panel.Hero.EvaluateAsync<string>("el => getComputedStyle(el).backgroundImage");
        Assert.That(hero, Does.Match(@"/plugins/img/header\.png"));
    }
}
