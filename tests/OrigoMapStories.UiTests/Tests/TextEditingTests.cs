using System.Text.RegularExpressions;
using OrigoMapStories.UiTests.Infrastructure;

namespace OrigoMapStories.UiTests.Tests;

/// <summary>Editing the rich text of a submenu as admin.</summary>
public class TextEditingTests : UiTestBase
{
    private async Task<Pages.TextPanel> EditBostaderNulageAsync()
    {
        var map = await OpenAsAdminAsync();
        var text = await map.OpenLayerAsync("Bostäder", "Nuläge");
        await text.StartEditingAsync();
        return text;
    }

    [Test]
    public async Task Saved_text_persists_after_reload_and_creates_a_version()
    {
        var text = await EditBostaderNulageAsync();
        await text.AppendParagraphAsync("Ett nytt stycke från testet.");
        await text.SaveAsync();

        await Page.ReloadAsync();
        await Expect(Map.PluginButton).ToBeVisibleAsync();
        await Expect(Map.Login.Root).ToHaveCountAsync(0);
        var reloaded = await Map.OpenLayerAsync("Bostäder", "Nuläge");
        await Expect(reloaded.Content).ToContainTextAsync("Ett nytt stycke från testet.");

        var versions = await ListVersionsAsync();
        Assert.That(versions, Has.Count.EqualTo(2));
        Assert.That(versions[0].GetProperty("isCurrent").GetBoolean(), Is.True);
        Assert.That(versions[0].GetProperty("description").GetString(), Is.EqualTo("Sparade text: Bostäder › Nuläge"));
    }

    [Test]
    public async Task Edit_mode_shows_toolbar_and_save_cancel()
    {
        var text = await EditBostaderNulageAsync();

        await Expect(text.Toolbar).ToBeVisibleAsync();
        await Expect(text.CancelButton).ToBeVisibleAsync();
        await Expect(text.EditButton).ToBeHiddenAsync();
    }

    [Test]
    public async Task Bold_and_heading_are_saved()
    {
        var text = await EditBostaderNulageAsync();
        await text.MoveCursorToEndAsync();
        await Page.Keyboard.PressAsync("Enter");
        await text.ToolbarButton("heading2").ClickAsync();
        await Page.Keyboard.TypeAsync("Ny rubrik");
        await Page.Keyboard.PressAsync("Enter");
        await text.ToolbarButton("bold").ClickAsync();
        await Page.Keyboard.TypeAsync("Fet text");
        await text.SaveAsync();

        await Expect(text.Content.Locator("h2")).ToHaveTextAsync("Ny rubrik");
        await Expect(text.Content.Locator("strong")).ToHaveTextAsync("Fet text");
        var saved = (await ApiGetJsonAsync("/api/content/Test_Bostader_Nulage")).ToString();
        Assert.That(saved, Does.Match(@"""level"":\s*2").And.Match(@"""type"":\s*""bold"""));
    }

    [Test]
    public async Task Cancel_discards_unsaved_changes()
    {
        var text = await EditBostaderNulageAsync();
        await text.AppendParagraphAsync("Detta ska inte sparas.");
        Assert.That(await text.CancelAsync(accept: true), Is.EqualTo(new[] { Pages.ConfirmDialog.DiscardMessage }));

        await Expect(text.Content).Not.ToContainTextAsync("Detta ska inte sparas.");
        await Expect(text.EditButton).ToBeVisibleAsync();
        Assert.That((await ListVersionsAsync()), Has.Count.EqualTo(1));
    }

    [Test]
    public async Task Text_can_be_created_for_a_submenu_without_text()
    {
        var map = await OpenAsAdminAsync();
        var text = await map.OpenLayerAsync("Bostäder", "Framtid 2040");
        await text.StartEditingAsync();
        await text.AppendParagraphAsync("Första texten för framtiden.");
        await text.SaveAsync();

        var saved = (await ApiGetJsonAsync("/api/content/Test_Bostader_Framtid")).ToString();
        Assert.That(saved, Does.Contain("Första texten för framtiden."));
        Assert.That(await TestDatabase.CurrentPathsAsync(), Does.Contain("layers/Test_Bostader_Framtid/text.json"));
    }

    [Test]
    public async Task Uploaded_image_is_inserted_and_stored_with_the_saved_text()
    {
        var text = await EditBostaderNulageAsync();
        await text.MoveCursorToEndAsync();
        await text.InsertImageAsync(Path.Combine(TestSettings.UploadsDir, "text-image.png"));

        await Expect(text.Images).ToHaveCountAsync(2);
        var src = await text.Images.Nth(1).GetAttributeAsync("src");
        Assert.That(src, Does.Match(@"/content-files/images/\d+-text_image\.png$"));

        await text.SaveAsync();
        var path = Regex.Match(src!, @"images/.+$").Value;
        Assert.That(await TestDatabase.CurrentPathsAsync(), Does.Contain(path));
        var res = await Page.APIRequest.GetAsync(src!);
        Assert.That(res.Status, Is.EqualTo(200));
        Assert.That(res.Headers["content-type"], Is.EqualTo("image/png"));
    }

    [Test]
    public async Task Removing_an_image_removes_it_from_the_next_version()
    {
        var text = await EditBostaderNulageAsync();
        Assert.That(await TestDatabase.CurrentPathsAsync(), Does.Contain("images/fixture-bild.png"));

        await text.ImageNodes.First.ClickAsync();
        await Page.Keyboard.PressAsync("Delete");
        await Expect(text.Images).ToHaveCountAsync(0);
        await text.SaveAsync();

        Assert.That(await TestDatabase.CurrentPathsAsync(), Does.Not.Contain("images/fixture-bild.png"));
        var res = await Page.APIRequest.GetAsync("/content-files/images/fixture-bild.png");
        Assert.That(res.Status, Is.EqualTo(404));
    }

    [Test]
    public async Task Empty_image_upload_is_rejected()
    {
        var token = await GetAdminTokenAsync();
        foreach (var url in new[] { "/api/images", "/api/site-assets/button-icon" })
        {
            var res = await Page.APIRequest.PostAsync(url, new()
            {
                Headers = new Dictionary<string, string> { ["Authorization"] = $"Bearer {token}" },
                Multipart = Context.APIRequest.CreateFormData().Set("file", new FilePayload { Name = "tom.png", MimeType = "image/png", Buffer = [] })
            });
            Assert.That(res.Status, Is.EqualTo(400), url);
            Assert.That((await res.JsonAsync())!.Value.GetProperty("error").GetString(), Is.EqualTo("Filen är tom"));
        }
        Assert.That(await ListVersionsAsync(), Has.Count.EqualTo(1));
    }

    [Test]
    public async Task Unsaved_uploaded_image_is_not_added_to_a_version()
    {
        var text = await EditBostaderNulageAsync();
        await text.MoveCursorToEndAsync();
        await text.InsertImageAsync(Path.Combine(TestSettings.UploadsDir, "text-image.png"));
        await Expect(text.Images).ToHaveCountAsync(2);
        Assert.That(await text.CancelAsync(accept: true), Is.EqualTo(new[] { Pages.ConfirmDialog.DiscardMessage }));
        await Expect(text.EditButton).ToBeVisibleAsync();

        Assert.That((await TestDatabase.CurrentPathsAsync()).Count(p => p.StartsWith("images/")), Is.EqualTo(1));
        Assert.That(await TestDatabase.CountAsync("SELECT count(*) FROM pending_upload"), Is.EqualTo(1));
    }

    [Test]
    public async Task Toolbar_stays_visible_when_scrolling_a_long_text()
    {
        var text = await EditBostaderNulageAsync();

        await text.AssertToolbarStaysUsableAtBottomAsync();
    }
}
