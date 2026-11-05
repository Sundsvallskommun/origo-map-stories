using OrigoMapStories.UiTests.Infrastructure;
using OrigoMapStories.UiTests.Pages;

namespace OrigoMapStories.UiTests.Tests;

/// <summary>Two admins editing the same content: the second save must not silently overwrite the first.</summary>
public class ConcurrencyTests : UiTestBase
{
    [Test]
    public async Task Second_text_save_gets_a_conflict_and_keeps_its_draft()
    {
        var (otherContext, otherPage) = await NewSessionAsync();
        try
        {
            var first = await (await OpenAsAdminAsync()).OpenLayerAsync("Bostäder", "Nuläge");
            var second = await (await OpenAsAdminAsync(otherPage)).OpenLayerAsync("Bostäder", "Nuläge");
            await first.StartEditingAsync();
            await second.StartEditingAsync();

            await first.AppendParagraphAsync("Ändring från admin 1");
            await first.SaveAsync();

            await second.AppendParagraphAsync("Ändring från admin 2");
            await second.SaveButton.ClickAsync();

            await Expect(second.Status).ToHaveTextAsync("Någon annan har sparat ändringar i detta innehåll. Ladda om för att se dem.");
            await Expect(second.Content).ToContainTextAsync("Ändring från admin 2");
            await Expect(second.SaveButton).ToBeVisibleAsync();

            var saved = (await ApiGetJsonAsync("/api/content/Test_Bostader_Nulage")).ToString();
            Assert.That(saved, Does.Contain("Ändring från admin 1").And.Not.Contain("Ändring från admin 2"));
            Assert.That(await ListVersionsAsync(), Has.Count.EqualTo(2));
        }
        finally
        {
            await otherContext.CloseAsync();
        }
    }

    [Test]
    public async Task Reloading_after_a_conflict_allows_saving_on_top_of_the_other_change()
    {
        var (otherContext, otherPage) = await NewSessionAsync();
        try
        {
            var first = await (await OpenAsAdminAsync()).OpenLayerAsync("Trafik", "Kollektivtrafik");
            var secondMap = await OpenAsAdminAsync(otherPage);
            var second = await secondMap.OpenLayerAsync("Trafik", "Kollektivtrafik");
            await first.StartEditingAsync();
            await second.StartEditingAsync();
            await first.AppendParagraphAsync("Först");
            await first.SaveAsync();
            await second.AppendParagraphAsync("Sedan");
            await second.SaveButton.ClickAsync();
            await Expect(second.Status).ToContainTextAsync("Någon annan har sparat");

            // "Avbryt" (confirming the unsaved-changes prompt) reloads the
            // latest text; editing again now works.
            Assert.That(await second.CancelAsync(accept: true), Is.EqualTo(new[] { ConfirmDialog.DiscardMessage }));
            await Expect(second.Content).ToContainTextAsync("Först");
            await second.StartEditingAsync();
            await second.AppendParagraphAsync("Sedan");
            await second.SaveAsync();

            var saved = (await ApiGetJsonAsync("/api/content/Test_Kollektivtrafik")).ToString();
            Assert.That(saved, Does.Contain("Först").And.Contain("Sedan"));
        }
        finally
        {
            await otherContext.CloseAsync();
        }
    }

    [Test]
    public async Task Second_site_config_save_gets_a_conflict()
    {
        var (otherContext, otherPage) = await NewSessionAsync();
        try
        {
            var firstMap = await OpenAsAdminAsync();
            await firstMap.SiteConfig.OpenAsync(await firstMap.OpenLayerPanelAsync());
            var secondMap = await OpenAsAdminAsync(otherPage);
            await secondMap.SiteConfig.OpenAsync(await secondMap.OpenLayerPanelAsync());

            await firstMap.SiteConfig.MenuLabel(0).FillAsync("Admin 1:s meny");
            await firstMap.SiteConfig.SaveAsync();

            await secondMap.SiteConfig.MenuLabel(1).FillAsync("Admin 2:s meny");
            await secondMap.SiteConfig.SaveButton.ClickAsync();

            await Expect(secondMap.SiteConfig.Status).ToHaveTextAsync(
                "Någon annan har sparat konfigurationen under tiden. Stäng och öppna Sajtkonfiguration igen för att se ändringarna.");
            var menus = (await ApiGetJsonAsync("/api/site-config")).GetProperty("menus");
            Assert.That(menus[0].GetProperty("label").GetString(), Is.EqualTo("Admin 1:s meny"));
            Assert.That(menus[1].GetProperty("label").GetString(), Is.EqualTo("Trafik"));
        }
        finally
        {
            await otherContext.CloseAsync();
        }
    }
}
