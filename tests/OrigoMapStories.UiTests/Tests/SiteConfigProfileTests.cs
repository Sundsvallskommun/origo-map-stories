using System.Text.RegularExpressions;
using OrigoMapStories.UiTests.Infrastructure;
using OrigoMapStories.UiTests.Pages;

namespace OrigoMapStories.UiTests.Tests;

/// <summary>The "Grafisk profil" tab: header text and image uploads with validation.</summary>
public class SiteConfigProfileTests : UiTestBase
{
    private MapPage _map = null!;

    private static string Upload(string file) => Path.Combine(TestSettings.UploadsDir, file);

    private async Task<SiteConfigEditor> OpenProfileAsync()
    {
        _map = await OpenAsAdminAsync();
        var panel = await _map.OpenLayerPanelAsync();
        await _map.SiteConfig.OpenAsync(panel);
        await _map.SiteConfig.SelectTabAsync("profil");
        return _map.SiteConfig;
    }

    [Test]
    public async Task Header_text_is_saved_and_shown_in_the_panel()
    {
        var cfg = await OpenProfileAsync();
        await Expect(cfg.HeaderText).ToHaveValueAsync("Testkarta");

        await cfg.HeaderText.FillAsync("Ny rubrik för kartan");
        await cfg.SaveAsync();
        await cfg.CloseAsync();

        await Expect(_map.LayerPanel.Title).ToHaveTextAsync("Ny rubrik för kartan");
    }

    [Test]
    public async Task Valid_button_icon_is_uploaded_and_applied()
    {
        var cfg = await OpenProfileAsync();
        await cfg.UploadAssetAsync("button-icon", Upload("icon-valid.png"));

        await Expect(cfg.AssetError("button-icon")).ToBeEmptyAsync();
        await Expect(cfg.AssetThumb("button-icon")).ToHaveAttributeAsync("src", new Regex(@"site-assets/button-icon\.png\?v=\d+"));
        await Expect(cfg.Status).ToHaveTextAsync("Bild uppladdad.");

        await cfg.SaveAsync();
        await Expect(Page.Locator(".o-mapstories-button-icon")).ToHaveAttributeAsync("src", new Regex(@"site-assets/button-icon\.png\?v=\d+"));
        await Expect(Page.Locator("link[rel='icon']")).ToHaveAttributeAsync("href", new Regex("site-assets/button-icon\\.png"));

        var versions = await ListVersionsAsync();
        Assert.That(versions.Select(v => v.GetProperty("description").GetString()), Does.Contain("Ny bild: Menyknapp"));
    }

    [Test]
    public async Task Button_icon_with_wrong_size_is_rejected()
    {
        var cfg = await OpenProfileAsync();
        await cfg.UploadAssetAsync("button-icon", Upload("icon-wrong-size.png"));

        await Expect(cfg.AssetError("button-icon")).ToHaveTextAsync("Bildstorleken måste vara 38×49 eller 76×98 px (bilden är 40×40)");
        Assert.That(await ListVersionsAsync(), Has.Count.EqualTo(1), "nothing may be uploaded");
    }

    [Test]
    public async Task Button_icon_without_alpha_channel_is_rejected()
    {
        var cfg = await OpenProfileAsync();
        await cfg.UploadAssetAsync("button-icon", Upload("icon-no-alpha.png"));

        await Expect(cfg.AssetError("button-icon")).ToHaveTextAsync("Bilden saknar genomskinlig bakgrund. Spara den som PNG med genomskinlig bakgrund och försök igen.");
        Assert.That(await ListVersionsAsync(), Has.Count.EqualTo(1));
    }

    [Test]
    public async Task Valid_corner_logo_is_uploaded_and_applied()
    {
        var cfg = await OpenProfileAsync();
        await cfg.UploadAssetAsync("corner-logo", Upload("logo-valid.png"));
        await Expect(cfg.AssetError("corner-logo")).ToBeEmptyAsync();
        await cfg.SaveAsync();

        await Expect(Page.Locator(".o-mapstories-corner-logo")).ToHaveAttributeAsync("src", new Regex(@"site-assets/corner-logo\.png\?v=\d+"));
    }

    [Test]
    public async Task Corner_logo_with_wrong_size_is_rejected()
    {
        var cfg = await OpenProfileAsync();
        await cfg.UploadAssetAsync("corner-logo", Upload("icon-valid.png"));

        await Expect(cfg.AssetError("corner-logo")).ToHaveTextAsync("Bildstorleken måste vara 240×82 eller 480×164 px (bilden är 38×49)");
    }

    [Test]
    public async Task Landscape_header_image_is_rejected()
    {
        var cfg = await OpenProfileAsync();
        await cfg.UploadAssetAsync("header-image", Upload("header-landscape.png"));

        await Expect(cfg.AssetError("header-image")).ToHaveTextAsync("Bilden måste vara i stående format (höjd > bredd). Fick 200×100");
        Assert.That(await ListVersionsAsync(), Has.Count.EqualTo(1));
    }

    [Test]
    public async Task Portrait_header_image_is_uploaded_and_shown_in_the_panel()
    {
        var cfg = await OpenProfileAsync();
        await cfg.UploadAssetAsync("header-image", Upload("header-portrait.png"));
        await Expect(cfg.AssetError("header-image")).ToBeEmptyAsync();
        await cfg.SaveAsync();
        await cfg.CloseAsync();

        await Expect(_map.LayerPanel.Hero).ToHaveAttributeAsync("style", new Regex(@"site-assets/header-image\.png\?v=\d+"));
        var served = await Page.APIRequest.GetAsync("/content-files/site-assets/header-image.png");
        Assert.That((await served.BodyAsync()).Length, Is.EqualTo(new FileInfo(Upload("header-portrait.png")).Length));
    }
}
