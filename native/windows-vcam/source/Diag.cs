using System;
using System.IO;
using System.Threading;

namespace BipCam.VirtualCamera.Source;

/// <summary>
/// The media source runs inside the Windows Frame Server service, where a managed exception is invisible:
/// it is converted to an HRESULT (a NullReferenceException becomes 0x80004003 / E_POINTER) and returned to the
/// caller. This logger records every exception with its stack trace to %ProgramData%\BipCam\logs\source.log.
/// </summary>
internal static class Diag
{
    private static readonly object Gate = new();
    [ThreadStatic] private static bool inLog;
    private static int installed;

    public static string LogDirectory => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "BipCam", "logs");

    public static void Install()
    {
        if (Interlocked.Exchange(ref installed, 1) != 0) return;
        Log($"BipCam source loaded. pid={Environment.ProcessId} process={Environment.ProcessPath} user={Environment.UserName}");
        AppDomain.CurrentDomain.FirstChanceException += (_, e) => Log("exception: " + e.Exception.GetType().Name + ": " + e.Exception.Message + Environment.NewLine + new System.Diagnostics.StackTrace(1, true));
        AppDomain.CurrentDomain.UnhandledException += (_, e) => Log("UNHANDLED: " + e.ExceptionObject);
    }

    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, int> Counts = new();

    /// <summary>Logs the first few calls of each COM entry point so the call order is visible.</summary>
    public static void Trace(string name)
    {
        var n = Counts.AddOrUpdate(name, 1, (_, c) => c + 1);
        if (n <= 3) Log("call " + name + (n == 3 ? " (further calls not logged)" : ""));
    }

    public static void Log(string message)
    {
        if (inLog) return;
        inLog = true;
        try
        {
            lock (Gate)
            {
                try
                {
                    Directory.CreateDirectory(LogDirectory);
                    File.AppendAllText(Path.Combine(LogDirectory, "source.log"), $"{DateTime.Now:O} {message}{Environment.NewLine}");
                }
                catch
                {
                    // Logging must never break the camera.
                }
            }
        }
        finally
        {
            inLog = false;
        }
    }
}
