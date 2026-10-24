using System;
using System.Runtime.InteropServices;
using DirectN;

namespace BipCam.VirtualCamera.Source;

[ComVisible(true)]
[Guid("B624D1C1-4F7D-4646-AAC0-1A51CD4CEDD7")]
[ClassInterface(ClassInterfaceType.None)]
public sealed class Activator : AttributesBase, IMFActivateRaw
{
    private MediaSource? source;

    static Activator()
    {
        Diag.Install();
    }

    public Activator() : base(8)
    {
        SetUINT32(MFConstants.MF_VIRTUALCAMERA_PROVIDE_ASSOCIATED_CAMERA_SOURCES, 0).ThrowOnError();
    }

    public HRESULT ActivateObject(Guid riid, out IntPtr ppv)
    {
        Diag.Trace("Activator.ActivateObject");
        Diag.Log($"ActivateObject riid={riid}");
        ppv = IntPtr.Zero;
        source ??= new MediaSource();
        // Return the pointer for the interface that was asked for (IMFMediaSourceEx), not a bare IUnknown:
        // Media Foundation calls methods on it directly.
        var unknown = Marshal.GetIUnknownForObject(source);
        try
        {
            var hr = Marshal.QueryInterface(unknown, in riid, out ppv);
            Diag.Log($"ActivateObject: QueryInterface -> 0x{hr:X8}, ppv=0x{ppv.ToInt64():X}");
            return hr;
        }
        finally
        {
            Marshal.Release(unknown);
        }
    }

    public HRESULT ShutdownObject()
    {
        Diag.Trace("Activator.ShutdownObject");
        source?.Shutdown();
        DisposeAttributes();
        return HRESULTS.S_OK;
    }

    public HRESULT DetachObject()
    {
        Diag.Trace("Activator.DetachObject");
        source = null;
        return HRESULTS.S_OK;
    }
}
