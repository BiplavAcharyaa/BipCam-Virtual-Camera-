using System;
using System.IO;
using System.Runtime.InteropServices;

internal static class Program
{
    private const string SourceClsid = "{B624D1C1-4F7D-4646-AAC0-1A51CD4CEDD7}";
    private const string FriendlyName = "BipCam Camera";

    private const int VirtualCameraTypeSoftwareCameraSource = 0;
    private const int VirtualCameraLifetimeSystem = 1;
    private const int VirtualCameraAccessCurrentUser = 0;
    private const int MFStartupFull = 0;
    private const int MFVersion = 0x00020070;

    [DllImport("mfsensorgroup.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int MFCreateVirtualCamera(
        int type,
        int lifetime,
        int access,
        string friendlyName,
        string sourceId,
        nint categories,
        uint categoryCount,
        out nint camera);

    [DllImport("mfsensorgroup.dll", ExactSpelling = true)]
    private static extern int MFIsVirtualCameraTypeSupported(int type, [MarshalAs(UnmanagedType.Bool)] out bool supported);

    [DllImport("mfplat.dll", ExactSpelling = true)]
    private static extern int MFStartup(int version, int flags);

    [DllImport("mfplat.dll", ExactSpelling = true)]
    private static extern int MFShutdown();

    // IMFVirtualCamera : IMFAttributes. IUnknown = slots 0-2, IMFAttributes = slots 3-32 (30 methods),
    // then AddDeviceSourceInfo(33) AddProperty(34) AddRegistryEntry(35) Start(36) Stop(37) Remove(38).
    private const int SlotStart = 36;
    private const int SlotStop = 37;
    private const int SlotRemove = 38;

    private static unsafe int CallVtable0(nint instance, int slot)
    {
        var vtable = *(nint*)instance;
        var method = (delegate* unmanaged<nint, int>)(*(nint*)((byte*)vtable + slot * IntPtr.Size));
        return method(instance);
    }

    private static unsafe int CallVtable1(nint instance, int slot, nint argument)
    {
        var vtable = *(nint*)instance;
        var method = (delegate* unmanaged<nint, nint, int>)(*(nint*)((byte*)vtable + slot * IntPtr.Size));
        return method(instance, argument);
    }

    private static int Main(string[] args)
    {
        var startup = MFStartup(MFVersion, MFStartupFull);
        if (startup < 0)
        {
            Console.Error.WriteLine($"Media Foundation startup failed: 0x{startup:X8}");
            return 20;
        }

        try
        {
            if (args.Length == 0) return Start();
            return args[0].ToLowerInvariant() switch
            {
                "start" => Start(),
                "stop" => Stop(),
                "remove" => Remove(),
                "install" => Start(),
                "status" => Status(),
                _ => 2
            };
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"BipCam virtual camera error: {ex.Message}");
            var tail = LogTail();
            if (tail.Length > 0) Console.Error.WriteLine("Camera source log (C:\\ProgramData\\BipCam\\logs\\source.log):" + Environment.NewLine + tail);
            return 1;
        }
        finally
        {
            MFShutdown();
        }
    }

    // Marshal.ThrowExceptionForHR maps E_POINTER to NullReferenceException ("Object reference not set..."),
    // which hides the real cause. Report the failing API and the raw HRESULT instead.
    private static string lastStage = "";

    private static void Check(int hr, string api)
    {
        if (hr < 0) throw new InvalidOperationException($"{api} failed with HRESULT 0x{hr:X8}.");
    }

    private static string LogTail()
    {
        try
        {
            var path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "BipCam", "logs", "source.log");
            if (!File.Exists(path)) return "";
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            using var reader = new StreamReader(stream);
            var text = reader.ReadToEnd();
            return text.Length > 2500 ? text.Substring(text.Length - 2500) : text;
        }
        catch
        {
            return "";
        }
    }

    private static int Create(out nint camera)
    {
        camera = 0;
        lastStage = "MFIsVirtualCameraTypeSupported";
        var hr = MFIsVirtualCameraTypeSupported(VirtualCameraTypeSoftwareCameraSource, out var supported);
        if (hr < 0) return hr;
        if (!supported)
        {
            lastStage = "MFIsVirtualCameraTypeSupported (software camera source not supported by this Windows build)";
            return unchecked((int)0x80004001);
        }

        lastStage = "MFCreateVirtualCamera";
        return MFCreateVirtualCamera(
            VirtualCameraTypeSoftwareCameraSource,
            VirtualCameraLifetimeSystem,
            VirtualCameraAccessCurrentUser,
            FriendlyName,
            SourceClsid,
            0,
            0,
            out camera);
    }

    private static int Start()
    {
        var hr = Create(out var camera);
        Check(hr, lastStage);
        if (camera == 0) throw new InvalidOperationException("MFCreateVirtualCamera returned a null camera pointer.");
        try
        {
            hr = CallVtable1(camera, SlotStart, 0);
            Check(hr, "IMFVirtualCamera::Start");
            Console.WriteLine(FriendlyName);
            return 0;
        }
        finally
        {
            Marshal.Release(camera);
        }
    }

    private static int Stop()
    {
        var hr = Create(out var camera);
        if (hr < 0) return hr;
        try
        {
            hr = CallVtable0(camera, SlotStop);
            return hr < 0 ? 1 : 0;
        }
        finally
        {
            Marshal.Release(camera);
        }
    }

    private static int Remove()
    {
        var hr = Create(out var camera);
        if (hr < 0) return 0;
        try
        {
            hr = CallVtable0(camera, SlotRemove);
            return hr < 0 ? 1 : 0;
        }
        finally
        {
            Marshal.Release(camera);
        }
    }

    private static int Status()
    {
        var hr = Create(out var camera);
        if (hr < 0)
        {
            Console.WriteLine("Unavailable");
            return 0;
        }

        try
        {
            Console.WriteLine("Available");
            return 0;
        }
        finally
        {
            Marshal.Release(camera);
        }
    }
}
