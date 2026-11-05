using System.Diagnostics;
using System.Text;

namespace OrigoMapStories.UiTests.Infrastructure;

/// <summary>Runs node scripts from the repository root with an explicit environment.</summary>
public static class NodeProcess
{
    public static Process Start(string script, IEnumerable<string> args, IDictionary<string, string> env, StringBuilder log)
    {
        var psi = new ProcessStartInfo("node")
        {
            WorkingDirectory = TestSettings.RepoRoot,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8
        };
        psi.ArgumentList.Add(script);
        foreach (var arg in args) psi.ArgumentList.Add(arg);
        foreach (var (key, value) in env) psi.Environment[key] = value;

        var process = new Process { StartInfo = psi, EnableRaisingEvents = true };
        process.OutputDataReceived += (_, e) => { if (e.Data != null) lock (log) log.AppendLine(e.Data); };
        process.ErrorDataReceived += (_, e) => { if (e.Data != null) lock (log) log.AppendLine(e.Data); };
        process.Start();
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        return process;
    }

    /// <summary>Runs a script to completion and throws with its output if it fails.</summary>
    public static async Task RunAsync(string script, IEnumerable<string> args, IDictionary<string, string> env, TimeSpan timeout)
    {
        var log = new StringBuilder();
        using var process = Start(script, args, env, log);
        using var cts = new CancellationTokenSource(timeout);
        try
        {
            await process.WaitForExitAsync(cts.Token);
        }
        catch (OperationCanceledException)
        {
            process.Kill(entireProcessTree: true);
            throw new TimeoutException($"node {script} did not finish within {timeout}.\n{log}");
        }
        process.WaitForExit();
        if (process.ExitCode != 0)
            throw new InvalidOperationException($"node {script} exited with code {process.ExitCode}.\n{log}");
    }
}
