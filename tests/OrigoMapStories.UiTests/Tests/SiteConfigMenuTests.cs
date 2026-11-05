using System.Text.Json;
using OrigoMapStories.UiTests.Infrastructure;
using OrigoMapStories.UiTests.Pages;

namespace OrigoMapStories.UiTests.Tests;

/// <summary>The "Menyer" tab of Sajtkonfiguration.</summary>
public class SiteConfigMenuTests : UiTestBase
{
    private MapPage _map = null!;

    private async Task<SiteConfigEditor> OpenEditorAsync()
    {
        _map = await OpenAsAdminAsync();
        var panel = await _map.OpenLayerPanelAsync();
        await _map.SiteConfig.OpenAsync(panel);
        return _map.SiteConfig;
    }

    private async Task<JsonElement> SiteConfigAsync() => await ApiGetJsonAsync("/api/site-config");

    [Test]
    public async Task Editor_shows_the_current_menus()
    {
        var cfg = await OpenEditorAsync();

        await Expect(cfg.MenuGroups).ToHaveCountAsync(2);
        await Expect(cfg.MenuLabel(0)).ToHaveValueAsync("Bostäder");
        await Expect(cfg.ItemLabel(0, 1)).ToHaveValueAsync("Framtid 2040");
        await Expect(cfg.MenuLabel(1)).ToHaveValueAsync("Trafik");
    }

    [Test]
    public async Task Adding_a_menu_and_submenu_updates_the_panel_and_creates_an_overlay()
    {
        var cfg = await OpenEditorAsync();
        await cfg.AddMenuButton.ClickAsync();
        await cfg.MenuLabel(2).FillAsync("Natur");
        await cfg.AddItemButton(2).ClickAsync();
        await cfg.ItemLabel(2, 0).FillAsync("Skog");
        await cfg.SaveAsync();
        await cfg.CloseAsync();

        Assert.That(await _map.LayerPanel.SectionLabelsAsync(), Is.EqualTo(new[] { "Bostäder", "Trafik", "Natur" }));
        Assert.That(await _map.LayerPanel.ItemLabelsAsync("Natur"), Is.EqualTo(new[] { "Skog" }));

        var item = (await SiteConfigAsync()).GetProperty("menus")[2].GetProperty("items")[0];
        var layerName = item.GetProperty("layerName").GetString()!;
        Assert.That(layerName, Does.StartWith("undermeny_"));
        Assert.That(await TestDatabase.CurrentPathsAsync(), Does.Contain($"layers/{layerName}/overlay.geojson"));

        // The new submenu works right away (empty overlay, placeholder text).
        var text = await _map.OpenLayerAsync("Natur", "Skog");
        await Expect(text.Title).ToHaveTextAsync("Natur – Skog");
    }

    [Test]
    public async Task Renaming_a_submenu_keeps_its_layer()
    {
        var cfg = await OpenEditorAsync();
        await cfg.ItemLabel(0, 0).FillAsync("Nuläge 2026");
        await cfg.SaveAsync();
        await cfg.CloseAsync();

        Assert.That(await _map.LayerPanel.ItemLabelsAsync("Bostäder"), Is.EqualTo(new[] { "Nuläge 2026", "Framtid 2040" }));
        var item = (await SiteConfigAsync()).GetProperty("menus")[0].GetProperty("items")[0];
        Assert.That(item.GetProperty("layerName").GetString(), Is.EqualTo("Test_Bostader_Nulage"));
        var text = await _map.OpenLayerAsync("Bostäder", "Nuläge 2026");
        await Expect(text.Content.Locator("h1")).ToHaveTextAsync("Bostäder nuläge");
    }

    [Test]
    public async Task Submenus_and_menus_can_be_reordered()
    {
        var cfg = await OpenEditorAsync();
        await cfg.MoveItemButton(0, 1, "up").ClickAsync();
        await cfg.MoveMenuButton(0, "down").ClickAsync();
        await cfg.SaveAsync();
        await cfg.CloseAsync();

        Assert.That(await _map.LayerPanel.SectionLabelsAsync(), Is.EqualTo(new[] { "Trafik", "Bostäder" }));
        Assert.That(await _map.LayerPanel.ItemLabelsAsync("Bostäder"), Is.EqualTo(new[] { "Framtid 2040", "Nuläge" }));
    }

    [Test]
    public async Task Deleting_a_submenu_removes_its_layer_from_the_new_version_only()
    {
        var cfg = await OpenEditorAsync();
        await cfg.DeleteItemButton(0, 1).ClickAsync();
        await cfg.SaveAsync();
        await cfg.CloseAsync();

        Assert.That(await _map.LayerPanel.ItemLabelsAsync("Bostäder"), Is.EqualTo(new[] { "Nuläge" }));
        Assert.That(await TestDatabase.CurrentPathsAsync(), Has.None.StartsWith("layers/Test_Bostader_Framtid/"));
        Assert.That(await TestDatabase.CountAsync(
            "SELECT count(*) FROM version_file WHERE version_id = 1 AND path LIKE 'layers/Test_Bostader_Framtid/%'"), Is.EqualTo(1));
        Assert.That(await TestDatabase.FeatureCountAsync("Test_Bostader_Framtid"), Is.EqualTo(0));
    }

    [Test]
    public async Task Deleting_a_menu_removes_its_submenus_layers()
    {
        var cfg = await OpenEditorAsync();
        await cfg.DeleteMenuButton(1).ClickAsync();
        await cfg.SaveAsync();
        await cfg.CloseAsync();

        Assert.That(await _map.LayerPanel.SectionLabelsAsync(), Is.EqualTo(new[] { "Bostäder" }));
        Assert.That(await TestDatabase.CurrentPathsAsync(), Has.None.StartsWith("layers/Test_Kollektivtrafik/"));
    }

    [Test]
    public async Task Empty_new_submenus_are_dropped_on_save()
    {
        var cfg = await OpenEditorAsync();
        await cfg.AddItemButton(0).ClickAsync();
        await Expect(cfg.Items(0)).ToHaveCountAsync(3);
        await cfg.SaveAsync();

        await Expect(cfg.Items(0)).ToHaveCountAsync(2);
        var items = (await SiteConfigAsync()).GetProperty("menus")[0].GetProperty("items");
        Assert.That(items.GetArrayLength(), Is.EqualTo(2));
    }

    [Test]
    public async Task Removing_all_menus_keeps_an_empty_menu_list()
    {
        var cfg = await OpenEditorAsync();
        await cfg.DeleteMenuButton(1).ClickAsync();
        await cfg.DeleteMenuButton(0).ClickAsync();
        await cfg.SaveAsync();
        await cfg.CloseAsync();

        await Expect(_map.LayerPanel.Sections).ToHaveCountAsync(0);
        Assert.That((await SiteConfigAsync()).GetProperty("menus").GetArrayLength(), Is.EqualTo(0));

        // Reopening the editor must not bring back default menus.
        await _map.SiteConfig.OpenAsync(_map.LayerPanel);
        await Expect(_map.SiteConfig.MenuGroups).ToHaveCountAsync(0);
    }

    [Test]
    public async Task Cancel_discards_menu_changes()
    {
        var cfg = await OpenEditorAsync();
        await cfg.MenuLabel(0).FillAsync("Ska inte sparas");
        Assert.That(await cfg.CancelAsync(accept: true), Is.EqualTo(new[] { ConfirmDialog.DiscardMessage }));
        await Expect(cfg.Root).ToBeHiddenAsync();

        Assert.That(await _map.LayerPanel.SectionLabelsAsync(), Is.EqualTo(new[] { "Bostäder", "Trafik" }));
        Assert.That(await ListVersionsAsync(), Has.Count.EqualTo(1));
    }

    [Test]
    public async Task Saving_the_config_creates_a_described_version()
    {
        var cfg = await OpenEditorAsync();
        await cfg.MenuLabel(1).FillAsync("Trafik och resor");
        await cfg.SaveAsync();

        var versions = await ListVersionsAsync();
        Assert.That(versions, Has.Count.EqualTo(2));
        Assert.That(versions[0].GetProperty("description").GetString(), Is.EqualTo("Sparade sajtkonfiguration"));
    }
}
