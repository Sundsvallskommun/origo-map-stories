using System.Text.Json;
using OrigoMapStories.UiTests.Infrastructure;
using OrigoMapStories.UiTests.Pages;

namespace OrigoMapStories.UiTests.Tests;

/// <summary>
/// The shared "Avbryt · Spara · Spara och stäng" buttons of the three editors
/// (text, map, site config) and the unsaved-changes prompt on Avbryt, × and Escape.
/// </summary>
public class SaveAndCloseTests : UiTestBase
{
    private static readonly string[] Prompted = [ConfirmDialog.DiscardMessage];

    // ─── Text editor ─────────────────────────────────────────────────────────

    private async Task<TextPanel> EditBostaderNulageAsync()
    {
        var map = await OpenAsAdminAsync();
        var text = await map.OpenLayerAsync("Bostäder", "Nuläge");
        await text.StartEditingAsync();
        return text;
    }

    private async Task<string> SavedTextAsync() =>
        (await ApiGetJsonAsync("/api/content/Test_Bostader_Nulage")).ToString();

    [Test]
    public async Task Text_buttons_are_cancel_save_and_save_and_close_in_that_order()
    {
        var text = await EditBostaderNulageAsync();

        await Expect(text.CancelButton).ToHaveTextAsync("Avbryt");
        await Expect(text.SaveButton).ToHaveTextAsync("Spara");
        await Expect(text.SaveAndCloseButton).ToHaveTextAsync("Spara och stäng");
        await Expect(text.SaveAndCloseButton).ToHaveClassAsync("o-btn-primary");
        var ids = await text.Root.Locator(".o-tp-footer button:visible").EvaluateAllAsync<string[]>("els => els.map(e => e.id)");
        Assert.That(ids.Where(id => id is "o-tp-cancel-btn" or "o-tp-save-btn" or "o-tp-save-close-btn"),
            Is.EqualTo(new[] { "o-tp-cancel-btn", "o-tp-save-btn", "o-tp-save-close-btn" }));
    }

    [Test]
    public async Task Text_save_and_close_saves_and_returns_to_read_mode()
    {
        var text = await EditBostaderNulageAsync();
        await text.AppendParagraphAsync("Sparad och stängd.");

        await text.SaveAndCloseAsync();

        await Expect(text.Content).ToContainTextAsync("Sparad och stängd.");
        await Expect(text.SaveAndCloseButton).ToBeHiddenAsync();
        Assert.That(await SavedTextAsync(), Does.Contain("Sparad och stängd."));
    }

    [Test]
    public async Task Text_save_and_close_stays_in_edit_mode_on_a_conflict()
    {
        var text = await EditBostaderNulageAsync();
        // Someone else saves the same text in the meantime.
        var token = await GetAdminTokenAsync();
        var doc = new { type = "doc", content = new object[] { new { type = "paragraph", content = new[] { new { type = "text", text = "Annan admin" } } } } };
        var res = await Page.APIRequest.PostAsync("/api/content/Test_Bostader_Nulage", new()
        {
            Headers = new Dictionary<string, string> { ["Authorization"] = $"Bearer {token}" },
            DataObject = doc
        });
        Assert.That(res.Ok, Is.True);

        await text.AppendParagraphAsync("Min ändring");
        await text.SaveAndCloseButton.ClickAsync();

        await Expect(text.Status).ToContainTextAsync("Någon annan har sparat");
        await Expect(text.SaveAndCloseButton).ToBeVisibleAsync();
        await Expect(text.Content).ToHaveAttributeAsync("contenteditable", "true");
        await Expect(text.Content).ToContainTextAsync("Min ändring");
    }

    [Test]
    public async Task Text_cancel_with_unsaved_changes_asks_first()
    {
        var text = await EditBostaderNulageAsync();
        await text.AppendParagraphAsync("Osparad rad");

        Assert.That(await text.CancelAsync(accept: false), Is.EqualTo(Prompted));
        await Expect(text.Content).ToHaveAttributeAsync("contenteditable", "true");
        await Expect(text.Content).ToContainTextAsync("Osparad rad");

        Assert.That(await text.CancelAsync(accept: true), Is.EqualTo(Prompted));
        await Expect(text.EditButton).ToBeVisibleAsync();
        await Expect(text.Content).Not.ToContainTextAsync("Osparad rad");
    }

    [Test]
    public async Task Text_cancel_without_changes_closes_without_asking()
    {
        var text = await EditBostaderNulageAsync();

        Assert.That(await text.CancelAsync(), Is.Empty);
        await Expect(text.EditButton).ToBeVisibleAsync();
    }

    [Test]
    public async Task Text_cancel_after_saving_does_not_ask()
    {
        var text = await EditBostaderNulageAsync();
        await text.AppendParagraphAsync("Sparad rad");
        await text.SaveAsync();

        Assert.That(await text.CancelAsync(), Is.Empty);
        await Expect(text.EditButton).ToBeVisibleAsync();
        await Expect(text.Content).ToContainTextAsync("Sparad rad");
    }

    [Test]
    public async Task Text_close_button_warns_about_unsaved_changes()
    {
        var text = await EditBostaderNulageAsync();
        await text.AppendParagraphAsync("Osparad rad");

        Assert.That(await text.CloseAsync(accept: false), Is.EqualTo(Prompted));
        await Expect(text.Root).ToBeVisibleAsync();
        await Expect(text.Content).ToContainTextAsync("Osparad rad");

        Assert.That(await text.CloseAsync(accept: true), Is.EqualTo(Prompted));
        await Expect(text.Root).ToBeHiddenAsync();
        Assert.That(await SavedTextAsync(), Does.Not.Contain("Osparad rad"));
    }

    [Test]
    public async Task Text_escape_acts_like_cancel()
    {
        var text = await EditBostaderNulageAsync();
        await text.AppendParagraphAsync("Osparad rad");

        Assert.That(await text.PressEscapeAsync(accept: false), Is.EqualTo(Prompted));
        await Expect(text.Content).ToHaveAttributeAsync("contenteditable", "true");

        Assert.That(await text.PressEscapeAsync(accept: true), Is.EqualTo(Prompted));
        await Expect(text.EditButton).ToBeVisibleAsync();
        await Expect(text.Content).Not.ToContainTextAsync("Osparad rad");
    }

    [Test]
    public async Task Switching_submenu_with_unsaved_text_asks_first()
    {
        var text = await EditBostaderNulageAsync();
        await text.AppendParagraphAsync("Osparad rad");
        var other = Map.LayerPanel.Item("Bostäder", "Framtid 2040");

        Assert.That(await ConfirmDialog.HandleAsync(Page, () => other.ClickAsync(), accept: false), Is.EqualTo(Prompted));
        await Expect(text.Title).ToHaveTextAsync("Bostäder – Nuläge");
        await Expect(text.Content).ToContainTextAsync("Osparad rad");

        Assert.That(await ConfirmDialog.HandleAsync(Page, () => other.ClickAsync(), accept: true), Is.EqualTo(Prompted));
        await Expect(text.Title).ToHaveTextAsync("Bostäder – Framtid 2040");
    }

    [Test]
    public async Task Closing_the_layer_panel_with_unsaved_text_asks_first()
    {
        var text = await EditBostaderNulageAsync();
        await text.AppendParagraphAsync("Osparad rad");

        Assert.That(await ConfirmDialog.HandleAsync(Page, () => Map.LayerPanel.CloseButton.ClickAsync(), accept: false), Is.EqualTo(Prompted));
        await Expect(Map.LayerPanel.Root).ToBeVisibleAsync();
        await Expect(text.Content).ToContainTextAsync("Osparad rad");

        Assert.That(await ConfirmDialog.HandleAsync(Page, () => Map.LayerPanel.CloseButton.ClickAsync(), accept: true), Is.EqualTo(Prompted));
        await Expect(Map.LayerPanel.Root).ToBeHiddenAsync();
        await Expect(text.Root).ToBeHiddenAsync();
    }

    // ─── Map editor ──────────────────────────────────────────────────────────

    private async Task<GeoJsonEditor> OpenMapEditorAsync()
    {
        var map = await OpenAsAdminAsync();
        var text = await map.OpenLayerAsync("Bostäder", "Nuläge");
        await text.MapEditorButton.ClickAsync();
        await map.MapEditor.WaitForLoadedAsync();
        return map.MapEditor;
    }

    private async Task<int> SavedFeatureCountAsync() =>
        (await ApiGetJsonAsync("/api/geojson/Test_Bostader_Nulage")).GetProperty("features").GetArrayLength();

    [Test]
    public async Task Map_editor_buttons_are_cancel_save_and_save_and_close_in_that_order()
    {
        var editor = await OpenMapEditorAsync();

        var buttons = await editor.Frame.Locator(".ed-toolbar-right button")
            .EvaluateAllAsync<string[]>("els => els.map(e => `${e.id}:${e.textContent.trim()}`)");
        Assert.That(buttons, Is.EqualTo(new[] { "ed-btn-close:Avbryt", "ed-btn-save:Spara", "ed-btn-save-close:Spara och stäng" }));
        await Expect(editor.SaveAndCloseButton).ToHaveClassAsync("ed-btn-primary");
    }

    [Test]
    public async Task Map_save_and_close_saves_and_closes_the_editor()
    {
        var editor = await OpenMapEditorAsync();
        await editor.AddPointAsync("node-main", 200, 200);

        await editor.SaveAndCloseAsync();

        Assert.That(await SavedFeatureCountAsync(), Is.EqualTo(3));
        await Expect(Map.TextPanel.Root).ToBeVisibleAsync();
    }

    [Test]
    public async Task Map_save_and_close_stays_open_on_a_conflict()
    {
        var editor = await OpenMapEditorAsync();
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
        await editor.SaveAndCloseButton.ClickAsync();

        await Expect(editor.Status).ToHaveTextAsync("Någon annan har sparat ändringar i detta innehåll. Ladda om för att se dem.");
        await Expect(editor.Modal).ToBeVisibleAsync();
        Assert.That(await editor.FeatureCountAsync(), Is.EqualTo(3));
        Assert.That(await SavedFeatureCountAsync(), Is.EqualTo(2));
    }

    [Test]
    public async Task Map_cancel_with_unsaved_changes_asks_first()
    {
        var editor = await OpenMapEditorAsync();
        await editor.AddPointAsync("node-main", 200, 200);

        Assert.That(await editor.CancelAsync(accept: false), Is.EqualTo(Prompted));
        await Expect(editor.Modal).ToBeVisibleAsync();
        Assert.That(await editor.FeatureCountAsync(), Is.EqualTo(3));

        Assert.That(await editor.CancelAsync(accept: true), Is.EqualTo(Prompted));
        await Expect(editor.Modal).ToBeHiddenAsync();
        Assert.That(await SavedFeatureCountAsync(), Is.EqualTo(2));
    }

    [Test]
    public async Task Map_cancel_without_changes_closes_without_asking()
    {
        var editor = await OpenMapEditorAsync();

        Assert.That(await editor.CancelAsync(), Is.Empty);
        await Expect(editor.Modal).ToBeHiddenAsync();
    }

    [Test]
    public async Task Map_cancel_after_saving_does_not_ask()
    {
        var editor = await OpenMapEditorAsync();
        await editor.AddPointAsync("node-main", 200, 200);
        await editor.SaveAsync();

        Assert.That(await editor.CancelAsync(), Is.Empty);
        await Expect(editor.Modal).ToBeHiddenAsync();
    }

    [Test]
    public async Task Map_escape_leaves_the_drawing_tool_first_then_acts_like_cancel()
    {
        var editor = await OpenMapEditorAsync();
        await editor.AddPointAsync("node-main", 200, 200);

        // The point tool is still active: Escape only leaves it.
        Assert.That(await editor.PressEscapeAsync(), Is.Empty);
        await Expect(editor.SelectTool).ToHaveClassAsync(new System.Text.RegularExpressions.Regex("is-active"));
        await Expect(editor.Modal).ToBeVisibleAsync();

        Assert.That(await editor.PressEscapeAsync(accept: false), Is.EqualTo(Prompted));
        await Expect(editor.Modal).ToBeVisibleAsync();

        Assert.That(await editor.PressEscapeAsync(accept: true), Is.EqualTo(Prompted));
        await Expect(editor.Modal).ToBeHiddenAsync();
        Assert.That(await SavedFeatureCountAsync(), Is.EqualTo(2));
    }

    // ─── Site config editor ──────────────────────────────────────────────────

    private async Task<SiteConfigEditor> OpenSiteConfigAsync()
    {
        var map = await OpenAsAdminAsync();
        await map.SiteConfig.OpenAsync(await map.OpenLayerPanelAsync());
        return map.SiteConfig;
    }

    private async Task<string?> SavedMenuLabelAsync(int menu) =>
        (await ApiGetJsonAsync("/api/site-config")).GetProperty("menus")[menu].GetProperty("label").GetString();

    [Test]
    public async Task Site_config_buttons_are_cancel_save_and_save_and_close_in_that_order()
    {
        var cfg = await OpenSiteConfigAsync();

        var buttons = await cfg.Root.Locator("#o-cfg-footer button")
            .EvaluateAllAsync<string[]>("els => els.map(e => `${e.id}:${e.textContent.trim()}`)");
        Assert.That(buttons, Is.EqualTo(new[] { "o-cfg-cancel:Avbryt", "o-cfg-save-btn:Spara", "o-cfg-save-close-btn:Spara och stäng" }));
        await Expect(cfg.SaveAndCloseButton).ToHaveClassAsync("o-btn-primary");
    }

    [Test]
    public async Task Site_config_versions_tab_hides_both_save_buttons()
    {
        var cfg = await OpenSiteConfigAsync();

        await cfg.SelectTabAsync("versioner");
        await Expect(cfg.SaveButton).ToBeHiddenAsync();
        await Expect(cfg.SaveAndCloseButton).ToBeHiddenAsync();
        await Expect(cfg.CancelButton).ToBeVisibleAsync();

        await cfg.SelectTabAsync("menyer");
        await Expect(cfg.SaveButton).ToBeVisibleAsync();
        await Expect(cfg.SaveAndCloseButton).ToBeVisibleAsync();
    }

    [Test]
    public async Task Site_config_save_and_close_saves_and_closes()
    {
        var cfg = await OpenSiteConfigAsync();
        await cfg.MenuLabel(1).FillAsync("Trafik och resor");

        await cfg.SaveAndCloseAsync();

        Assert.That(await SavedMenuLabelAsync(1), Is.EqualTo("Trafik och resor"));
        Assert.That(await Map.LayerPanel.SectionLabelsAsync(), Is.EqualTo(new[] { "Bostäder", "Trafik och resor" }));
    }

    [Test]
    public async Task Site_config_save_and_close_stays_open_on_a_conflict()
    {
        var cfg = await OpenSiteConfigAsync();
        // Another admin saves the config in the meantime.
        var token = await GetAdminTokenAsync();
        var current = JsonSerializer.Deserialize<Dictionary<string, object>>((await ApiGetJsonAsync("/api/site-config")).GetRawText())!;
        current["headerText"] = "Annan admin";
        var put = await Page.APIRequest.PutAsync("/api/site-config", new()
        {
            Headers = new Dictionary<string, string> { ["Authorization"] = $"Bearer {token}" },
            DataObject = current
        });
        Assert.That(put.Ok, Is.True, $"PUT /api/site-config returned {put.Status}");

        await cfg.MenuLabel(1).FillAsync("Min ändring");
        await cfg.SaveAndCloseButton.ClickAsync();

        await Expect(cfg.Status).ToContainTextAsync("Någon annan har sparat konfigurationen");
        await Expect(cfg.Root).ToBeVisibleAsync();
        await Expect(cfg.MenuLabel(1)).ToHaveValueAsync("Min ändring");
        Assert.That(await SavedMenuLabelAsync(1), Is.EqualTo("Trafik"));
    }

    [Test]
    public async Task Site_config_cancel_with_unsaved_changes_asks_first()
    {
        var cfg = await OpenSiteConfigAsync();
        await cfg.MenuLabel(0).FillAsync("Ska inte sparas");

        Assert.That(await cfg.CancelAsync(accept: false), Is.EqualTo(Prompted));
        await Expect(cfg.Root).ToBeVisibleAsync();
        await Expect(cfg.MenuLabel(0)).ToHaveValueAsync("Ska inte sparas");

        Assert.That(await cfg.CancelAsync(accept: true), Is.EqualTo(Prompted));
        await Expect(cfg.Root).ToBeHiddenAsync();
        Assert.That(await SavedMenuLabelAsync(0), Is.EqualTo("Bostäder"));
    }

    [Test]
    public async Task Site_config_cancel_without_changes_closes_without_asking()
    {
        var cfg = await OpenSiteConfigAsync();

        Assert.That(await cfg.CancelAsync(), Is.Empty);
        await Expect(cfg.Root).ToBeHiddenAsync();
    }

    [Test]
    public async Task Site_config_header_text_change_counts_as_unsaved()
    {
        var cfg = await OpenSiteConfigAsync();
        await cfg.SelectTabAsync("profil");
        await cfg.HeaderText.FillAsync("Ny rubrik");

        Assert.That(await cfg.CancelAsync(accept: false), Is.EqualTo(Prompted));
        await cfg.SaveAsync();
        Assert.That(await cfg.CancelAsync(), Is.Empty);
        await Expect(cfg.Root).ToBeHiddenAsync();
    }

    [Test]
    public async Task Site_config_close_button_and_escape_warn_about_unsaved_changes()
    {
        var cfg = await OpenSiteConfigAsync();
        await cfg.MenuLabel(0).FillAsync("Ska inte sparas");

        Assert.That(await cfg.CloseWithPromptAsync(accept: false), Is.EqualTo(Prompted));
        await Expect(cfg.Root).ToBeVisibleAsync();

        Assert.That(await cfg.PressEscapeAsync(accept: false), Is.EqualTo(Prompted));
        await Expect(cfg.Root).ToBeVisibleAsync();

        Assert.That(await cfg.PressEscapeAsync(accept: true), Is.EqualTo(Prompted));
        await Expect(cfg.Root).ToBeHiddenAsync();
        Assert.That(await SavedMenuLabelAsync(0), Is.EqualTo("Bostäder"));
    }
}
