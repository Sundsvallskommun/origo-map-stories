using System.Text.RegularExpressions;
using OrigoMapStories.UiTests.Infrastructure;

namespace OrigoMapStories.UiTests.Tests;

/// <summary>
/// The "next" arrow at the end of each text: reads the whole document in menu
/// order. Fixture menu: Bostäder (Nuläge, Framtid 2040), Trafik (Kollektivtrafik).
/// </summary>
public class SubmenuNavigationTests : UiTestBase
{
    private static readonly Regex Active = new("is-active");

    [Test]
    public async Task Next_arrow_opens_the_next_submenu_in_the_same_section()
    {
        await Map.GotoAsync();
        var text = await Map.OpenLayerAsync("Bostäder", "Nuläge");

        await Expect(text.NextButton).ToBeVisibleAsync();
        await Expect(text.NextButton).ToHaveAttributeAsync("aria-label", "Nästa: Framtid 2040");
        await text.NextButton.ClickAsync();

        await Expect(text.Title).ToHaveTextAsync("Bostäder – Framtid 2040");
        await Expect(Map.LayerPanel.Item("Bostäder", "Framtid 2040")).ToHaveClassAsync(Active);
        await Expect(Map.LayerPanel.Item("Bostäder", "Nuläge")).Not.ToHaveClassAsync(Active);
        await Expect(Map.TextPanel.Root).ToHaveCountAsync(1);
        Assert.That(await Map.IsLayerVisibleAsync("Test_Bostader_Nulage"), Is.False);
        AssertNoJsErrors();
    }

    [Test]
    public async Task Next_arrow_crosses_into_the_next_section()
    {
        await Map.GotoAsync();
        var text = await Map.OpenLayerAsync("Bostäder", "Framtid 2040");

        await Expect(text.NextButton).ToHaveAttributeAsync("aria-label", "Nästa: Kollektivtrafik");
        await text.NextButton.ClickAsync();

        await Expect(text.Title).ToHaveTextAsync("Trafik – Kollektivtrafik");
        await Expect(Map.LayerPanel.Section("Trafik")).ToHaveAttributeAsync("aria-expanded", "true");
        await Expect(Map.LayerPanel.Section("Bostäder")).ToHaveAttributeAsync("aria-expanded", "false");
        await Expect(Map.LayerPanel.Item("Trafik", "Kollektivtrafik")).ToHaveClassAsync(Active);
        // Same as clicking the submenu: its layer is shown and the heading link fires.
        Assert.That(await Map.IsLayerVisibleAsync("Test_Kollektivtrafik"), Is.True);
        await WaitForValueAsync(() => Map.HighlightCountAsync(), 1, "heading link object highlighted");
        AssertNoJsErrors();
    }

    [Test]
    public async Task Next_submenu_opens_scrolled_to_the_top()
    {
        await Map.GotoAsync();
        var text = await Map.OpenLayerAsync("Bostäder", "Nuläge");
        await text.NextButton.ScrollIntoViewIfNeededAsync();

        await text.NextButton.ClickAsync();

        await Expect(text.Title).ToHaveTextAsync("Bostäder – Framtid 2040");
        await text.WaitForContentAsync();
        Assert.That(await text.Body.EvaluateAsync<double>("el => el.scrollTop"), Is.EqualTo(0));
    }

    [Test]
    public async Task Last_submenu_has_no_next_arrow()
    {
        await Map.GotoAsync();
        var text = await Map.OpenLayerAsync("Trafik", "Kollektivtrafik");

        await Expect(text.NextButton).ToBeHiddenAsync();
    }

    [Test]
    public async Task Next_arrow_is_hidden_while_editing()
    {
        var map = await OpenAsAdminAsync();
        var text = await map.OpenLayerAsync("Bostäder", "Nuläge");
        await Expect(text.NextButton).ToBeVisibleAsync();

        await text.StartEditingAsync();
        await Expect(text.NextButton).ToBeHiddenAsync();

        await text.CancelButton.ClickAsync();
        await Expect(text.NextButton).ToBeVisibleAsync();
    }
}
