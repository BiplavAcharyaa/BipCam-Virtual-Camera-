using System;
using System.Runtime.InteropServices;
using DirectN;

namespace BipCam.VirtualCamera.Source;

internal sealed class MediaSource : AttributesBase, IMFMediaSourceEx, IMFGetService, IKsControl, IMFSampleAllocatorControl
{
    // winerror.h: ERROR_SET_NOT_FOUND. DirectN 1.18 does not ship a Win32Error enum.
    private const int ErrorSetNotFound = 1169;

    private readonly object gate = new();
    private readonly MediaStream stream;
    private IComObject<IMFMediaEventQueue>? queue;
    private IComObject<IMFPresentationDescriptor>? descriptor;

    public MediaSource() : base(16)
    {
        stream = new MediaStream(this, 0);
        Functions.MFCreatePresentationDescriptor(1, new[] { stream.Descriptor }, out var pd).ThrowOnError();
        descriptor = new ComObject<IMFPresentationDescriptor>(pd);
        Functions.MFCreateEventQueue(out var eq).ThrowOnError();
        queue = new ComObject<IMFMediaEventQueue>(eq);
        Functions.MFCreateSensorProfileCollection(out var profiles).ThrowOnError();
        Functions.MFCreateSensorProfile(KSMedia.KSCAMERAPROFILE_Legacy, 0, null, out var legacy).ThrowOnError();
        legacy.AddProfileFilter(0, "((RES==;FRT<=30,1;SUT==))").ThrowOnError();
        profiles.AddProfile(legacy).ThrowOnError();
        Functions.MFCreateSensorProfile(KSMedia.KSCAMERAPROFILE_HighFrameRate, 0, null, out var high).ThrowOnError();
        high.AddProfileFilter(0, "((RES==;FRT>=60,1;SUT==))").ThrowOnError();
        profiles.AddProfile(high).ThrowOnError();
        SetUnknown(MFConstants.MF_DEVICEMFT_SENSORPROFILE_COLLECTION, profiles).ThrowOnError();
    }

    public HRESULT GetCharacteristics(out uint characteristics) { Diag.Trace("Source.GetCharacteristics"); characteristics = (uint)_MFMEDIASOURCE_CHARACTERISTICS.MFMEDIASOURCE_IS_LIVE; return HRESULTS.S_OK; }
    public HRESULT CreatePresentationDescriptor(out IMFPresentationDescriptor pd)
    {
        Diag.Trace("Source.CreatePresentationDescriptor");
        var current = descriptor;
        if (current == null) { pd = null!; return HRESULTS.MF_E_SHUTDOWN; }
        return current.Object.Clone(out pd);
    }
    public HRESULT Pause() { Diag.Trace("Source.Pause"); return HRESULTS.MF_E_INVALID_STATE_TRANSITION; }
    public HRESULT Stop() { Diag.Trace("Source.Stop"); return stream.Stop(); }
    public HRESULT Start(IMFPresentationDescriptor presentationDescriptor, nint guidTimeFormat, PROPVARIANT startPosition)
    {
        Diag.Trace("Source.Start");
        Diag.Log("MediaSource.Start");
        presentationDescriptor.GetStreamDescriptorByIndex(0, out var selected, out var desc).ThrowOnError();
        if (selected)
        {
            desc.GetMediaTypeHandler(out var handler).ThrowOnError();
            handler.GetCurrentMediaType(out var type).ThrowOnError();
            descriptor!.Object.SelectStream(0).ThrowOnError();
            queue!.Object.QueueEventParamUnk((uint)__MIDL___MIDL_itf_mfobjects_0000_0013_0001.MENewStream, Guid.Empty, HRESULTS.S_OK, stream).ThrowOnError();
            stream.Start(type).ThrowOnError();
        }
        return queue!.Object.QueueEventParamVar((uint)__MIDL___MIDL_itf_mfobjects_0000_0013_0001.MESourceStarted, Guid.Empty, HRESULTS.S_OK, null);
    }

    public HRESULT Shutdown()
    {
        Diag.Trace("Source.Shutdown");
        lock (gate)
        {
            stream.Shutdown();
            queue?.Dispose(); queue = null;
            descriptor?.Dispose(); descriptor = null;
            DisposeAttributes();
        }
        return HRESULTS.S_OK;
    }

    public HRESULT GetSourceAttributes(out IMFAttributes attributes) { Diag.Trace("Source.GetSourceAttributes"); attributes = AttributeStore; return HRESULTS.S_OK; }
    public HRESULT GetStreamAttributes(uint id, out IMFAttributes attributes) { Diag.Trace("Source.GetStreamAttributes"); attributes = stream; return id == 0 ? HRESULTS.S_OK : HRESULTS.E_INVALIDARG; }
    public HRESULT SetD3DManager(object manager) { Diag.Trace("Source.SetD3DManager"); return HRESULTS.S_OK; }
    public HRESULT SetMediaType(uint id, IMFMediaType type) { Diag.Trace("Source.SetMediaType"); return HRESULTS.S_OK; }
    public HRESULT GetService(Guid service, Guid iid, out object ppv) { Diag.Trace("Source.GetService"); ppv = null!; return HRESULTS.MF_E_UNSUPPORTED_SERVICE; }
    public HRESULT SetDefaultAllocator(uint streamId, object allocator) { Diag.Trace("Source.SetDefaultAllocator"); return HRESULTS.S_OK; }
    public HRESULT GetAllocatorUsage(uint streamId, out uint inputStreamId, out MFSampleAllocatorUsage usage) { Diag.Trace("Source.GetAllocatorUsage"); inputStreamId = streamId; usage = MFSampleAllocatorUsage.MFSampleAllocatorUsage_UsesProvidedAllocator; return HRESULTS.S_OK; }
    public HRESULT GetEvent(uint flags, out IMFMediaEvent evt)
    {
        Diag.Trace("Source.GetEvent");
        var q = queue;
        if (q == null) { evt = null!; return HRESULTS.MF_E_SHUTDOWN; }
        return q.Object.GetEvent(flags, out evt);
    }

    public HRESULT BeginGetEvent(IMFAsyncCallback callback, object state)
    {
        Diag.Trace("Source.BeginGetEvent");
        var q = queue;
        if (q == null) return HRESULTS.MF_E_SHUTDOWN;
        return q.Object.BeginGetEvent(callback, state);
    }

    public HRESULT EndGetEvent(IMFAsyncResult result, out IMFMediaEvent evt)
    {
        Diag.Trace("Source.EndGetEvent");
        var q = queue;
        if (q == null) { evt = null!; return HRESULTS.MF_E_SHUTDOWN; }
        return q.Object.EndGetEvent(result, out evt);
    }

    public HRESULT QueueEvent(uint type, Guid extendedType, HRESULT hrStatus, PROPVARIANT value)
    {
        Diag.Trace("Source.QueueEvent");
        var q = queue;
        if (q == null) return HRESULTS.MF_E_SHUTDOWN;
        return q.Object.QueueEventParamVar(type, extendedType, hrStatus, value);
    }
    public HRESULT KsProperty(ref KSIDENTIFIER property, uint propertyLength, nint propertyData, uint dataLength, out uint bytesReturned) { Diag.Trace("Source.KsProperty"); bytesReturned = 0; return HRESULT.FromWin32(ErrorSetNotFound); }
    public HRESULT KsMethod(ref KSIDENTIFIER method, uint methodLength, nint methodData, uint dataLength, out uint bytesReturned) { Diag.Trace("Source.KsMethod"); bytesReturned = 0; return HRESULT.FromWin32(ErrorSetNotFound); }
    public HRESULT KsEvent(ref KSIDENTIFIER evt, uint eventLength, nint eventData, uint dataLength, out uint bytesReturned) { Diag.Trace("Source.KsEvent"); bytesReturned = 0; return HRESULT.FromWin32(ErrorSetNotFound); }
}
