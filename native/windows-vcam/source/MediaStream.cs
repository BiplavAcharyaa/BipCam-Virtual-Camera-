using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using DirectN;

namespace BipCam.VirtualCamera.Source;

internal sealed class MediaStream : AttributesBase, IMFMediaStream2, IKsControl
{
    private readonly object gate = new();
    private readonly MediaSource source;
    private IComObject<IMFMediaEventQueue>? queue;
    private IComObject<IMFStreamDescriptor>? descriptor;
    private _MF_STREAM_STATE state;
    private static readonly Guid Nv12Subtype = new("3231564E-0000-0010-8000-00AA00389B71");
    private const uint Nv12FourCc = 0x3231564E;
    private const uint Rgb32FourCc = 22; // D3DFMT_X8R8G8B8 == MFVideoFormat_RGB32
    private Guid format = Nv12Subtype;
    private int width = 1280;
    private int height = 720;
    private int fps = 30;
    private long nextDue;

    public MediaStream(MediaSource source, uint index) : base(16)
    {
        this.source = source;
        SetGUID(MFConstants.MF_DEVICESTREAM_STREAM_CATEGORY, KSMedia.PINNAME_VIDEO_CAPTURE).ThrowOnError();
        SetUINT32(MFConstants.MF_DEVICESTREAM_STREAM_ID, index).ThrowOnError();
        SetUINT32(MFConstants.MF_DEVICESTREAM_FRAMESERVER_SHARED, 1).ThrowOnError();
        SetUINT32(MFConstants.MF_DEVICESTREAM_ATTRIBUTE_FRAMESOURCE_TYPES, (uint)_MFFrameSourceTypes.MFFrameSourceTypes_Color).ThrowOnError();
        Functions.MFCreateEventQueue(out var eventQueue).ThrowOnError();
        queue = new ComObject<IMFMediaEventQueue>(eventQueue);
        // NV12 first (what Teams / Zoom / Meet / WhatsApp / Chrome expect from a webcam), RGB32 as a fallback.
        var modes = new[] { (1280, 720, 30), (1280, 720, 60), (1920, 1080, 30), (1920, 1080, 60), (640, 360, 30), (960, 540, 30), (640, 480, 30) };
        var typeList = new System.Collections.Generic.List<IMFMediaType>();
        foreach (var mode in modes) typeList.Add(CreateMediaType(Nv12Subtype, mode.Item1, mode.Item2, mode.Item3));
        foreach (var mode in modes)
            if (mode.Item3 <= 30) typeList.Add(CreateMediaType(MFConstants.MFVideoFormat_RGB32, mode.Item1, mode.Item2, mode.Item3));
        var mediaTypes = typeList.ToArray();
        Functions.MFCreateStreamDescriptor(index, mediaTypes.Length, mediaTypes, out var desc).ThrowOnError();
        desc.GetMediaTypeHandler(out var handler).ThrowOnError();
        handler.SetCurrentMediaType(mediaTypes[0]).ThrowOnError();
        descriptor = new ComObject<IMFStreamDescriptor>(desc);
    }

    private static IMFMediaType CreateMediaType(Guid subtype, int w, int h, int frameRate)
    {
        var isNv12 = subtype == Nv12Subtype;
        Functions.MFCreateMediaType(out var type).ThrowOnError();
        type.SetGUID(MFConstants.MF_MT_MAJOR_TYPE, MFConstants.MFMediaType_Video).ThrowOnError();
        type.SetGUID(MFConstants.MF_MT_SUBTYPE, subtype).ThrowOnError();
        type.SetSize(MFConstants.MF_MT_FRAME_SIZE, (uint)w, (uint)h);
        type.SetUINT32(MFConstants.MF_MT_DEFAULT_STRIDE, (uint)(isNv12 ? w : w * 4)).ThrowOnError();
        type.SetUINT32(MFConstants.MF_MT_INTERLACE_MODE, (uint)_MFVideoInterlaceMode.MFVideoInterlace_Progressive).ThrowOnError();
        type.SetUINT32(MFConstants.MF_MT_ALL_SAMPLES_INDEPENDENT, 1).ThrowOnError();
        type.SetRatio(MFConstants.MF_MT_FRAME_RATE, (uint)frameRate, 1);
        type.SetRatio(MFConstants.MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
        return type;
    }

    public HRESULT Start(IMFMediaType? type)
    {
        Diag.Trace("Stream.Start");
        if (queue == null) return HRESULTS.MF_E_SHUTDOWN;
        if (type != null)
        {
            type.GetGUID(MFConstants.MF_MT_SUBTYPE, out format).ThrowOnError();
            if (!type.TryGetSize(MFConstants.MF_MT_FRAME_SIZE, out var w, out var h)) return HRESULTS.MF_E_INVALIDMEDIATYPE;
            if (!type.TryGetRatio(MFConstants.MF_MT_FRAME_RATE, out var n, out var d)) return HRESULTS.MF_E_INVALIDMEDIATYPE;
            width = (int)w;
            height = (int)h;
            fps = d == 0 ? 30 : Math.Max(1, (int)Math.Round((double)n / d));
        }
        BeginHighResTimer();
        state = _MF_STREAM_STATE.MF_STREAM_STATE_RUNNING;
        nextDue = 0;
        return queue.Object.QueueEventParamVar((uint)__MIDL___MIDL_itf_mfobjects_0000_0013_0001.MEStreamStarted, Guid.Empty, HRESULTS.S_OK, null);
    }

    public HRESULT Stop()
    {
        Diag.Trace("Stream.Stop");
        if (queue == null) return HRESULTS.MF_E_SHUTDOWN;
        state = _MF_STREAM_STATE.MF_STREAM_STATE_STOPPED;
        EndHighResTimer();
        return queue.Object.QueueEventParamVar((uint)__MIDL___MIDL_itf_mfobjects_0000_0013_0001.MEStreamStopped, Guid.Empty, HRESULTS.S_OK, null);
    }

    public IMFStreamDescriptor Descriptor => descriptor?.Object!;
    public HRESULT GetMediaSource(out IMFMediaSource mediaSource) { Diag.Trace("Stream.GetMediaSource"); mediaSource = source; return HRESULTS.S_OK; }
    public HRESULT GetStreamDescriptor(out IMFStreamDescriptor streamDescriptor) { Diag.Trace("Stream.GetStreamDescriptor"); streamDescriptor = descriptor?.Object!; return descriptor == null ? HRESULTS.MF_E_SHUTDOWN : HRESULTS.S_OK; }

    public HRESULT RequestSample(object? token)
    {
        Diag.Trace("Stream.RequestSample");
        if (queue == null || state == _MF_STREAM_STATE.MF_STREAM_STATE_STOPPED) return HRESULTS.MF_E_SHUTDOWN;
        try
        {
            Pace();
            using var sample = CreateSample();
            if (token != null) sample.Object.SetUnknown(MFConstants.MFSampleExtension_Token, token).ThrowOnError();
            return queue.Object.QueueEventParamUnk((uint)__MIDL___MIDL_itf_mfobjects_0000_0013_0001.MEMediaSample, Guid.Empty, HRESULTS.S_OK, sample.Object);
        }
        catch
        {
            return HRESULTS.E_FAIL;
        }
    }

    [DllImport("winmm.dll")] private static extern uint timeBeginPeriod(uint milliseconds);
    [DllImport("winmm.dll")] private static extern uint timeEndPeriod(uint milliseconds);
    private bool highResTimer;

    private void BeginHighResTimer()
    {
        // Windows sleeps in ~15.6 ms steps by default, so a 60 FPS source (16.7 ms per frame) silently ran at ~30 FPS.
        if (highResTimer) return;
        try { timeBeginPeriod(1); highResTimer = true; } catch { }
    }

    private void EndHighResTimer()
    {
        if (!highResTimer) return;
        try { timeEndPeriod(1); } catch { }
        highResTimer = false;
    }

    // A live source must not run faster than its negotiated frame rate, otherwise the client
    // pulls samples in a tight loop and burns CPU / floods the bridge. It must also not run SLOWER, so the
    // wait is a coarse sleep followed by a short spin for the last ~1.5 ms.
    private void Pace()
    {
        long target;
        lock (gate)
        {
            var interval = Stopwatch.Frequency / Math.Max(1, fps);
            var now = Stopwatch.GetTimestamp();
            if (nextDue == 0 || now - nextDue > interval * 4) nextDue = now;
            target = nextDue;
            nextDue += interval;
        }
        var wait = target - Stopwatch.GetTimestamp();
        if (wait <= 0) return;
        var ms = (int)(wait * 1000 / Stopwatch.Frequency);
        if (ms > 2) Thread.Sleep(Math.Min(ms - 1, 100));
        while (Stopwatch.GetTimestamp() < target) Thread.SpinWait(40);
    }

    private ComObject<IMFSample> CreateSample()
    {
        var nv12 = format == Nv12Subtype;
        var w = width;
        var h = height;
        Functions.MFCreateSample(out var sample).ThrowOnError();
        Functions.MFCreate2DMediaBuffer((uint)w, (uint)h, nv12 ? Nv12FourCc : Rgb32FourCc, false, out var mediaBuffer).ThrowOnError();
        using var buffer = new ComObject<IMFMediaBuffer>(mediaBuffer);
        var unknown = Marshal.GetIUnknownForObject(buffer.Object);
        var iid = typeof(IMF2DBuffer2).GUID;
        Marshal.QueryInterface(unknown, in iid, out var bufferPtr);
        Marshal.Release(unknown);
        if (bufferPtr == 0) throw new InvalidOperationException("The Media Foundation buffer does not expose IMF2DBuffer2.");
        var buffer2 = (IMF2DBuffer2)Marshal.GetObjectForIUnknown(bufferPtr);
        var bufferLength = 0;
        try
        {
            buffer2.Lock2DSize(_MF2DBuffer_LockFlags.MF2DBuffer_LockFlags_Write, out var scanline, out var pitch, out _, out var length).ThrowOnError();
            bufferLength = (int)length;
            try
            {
                if (nv12) PipeFrames.RenderNv12(scanline, pitch, w, h);
                else PipeFrames.RenderBgra(scanline, pitch, w, h);
            }
            finally { buffer2.Unlock2D().ThrowOnError(); }
        }
        finally
        {
            Marshal.ReleaseComObject(buffer2);
            Marshal.Release(bufferPtr);
        }
        if (bufferLength > 0) mediaBuffer.SetCurrentLength((uint)bufferLength);
        sample.AddBuffer(mediaBuffer).ThrowOnError();
        sample.SetSampleTime(Functions.MFGetSystemTime()).ThrowOnError();
        sample.SetSampleDuration(10_000_000 / Math.Max(1, fps)).ThrowOnError();
        return new ComObject<IMFSample>(sample);
    }

    public HRESULT SetStreamState(_MF_STREAM_STATE value)
    {
        Diag.Trace("Stream.SetStreamState");
        if (state == value) return HRESULTS.S_OK;
        return value switch
        {
            _MF_STREAM_STATE.MF_STREAM_STATE_RUNNING => Start(null),
            _MF_STREAM_STATE.MF_STREAM_STATE_STOPPED => Stop(),
            _MF_STREAM_STATE.MF_STREAM_STATE_PAUSED => HRESULTS.MF_E_INVALID_STATE_TRANSITION,
            _ => HRESULTS.MF_E_INVALID_STATE_TRANSITION
        };
    }

    public HRESULT GetStreamState(out _MF_STREAM_STATE value) { Diag.Trace("Stream.GetStreamState"); value = state; return HRESULTS.S_OK; }
    public HRESULT GetEvent(uint flags, out IMFMediaEvent evt)
    {
        Diag.Trace("Stream.GetEvent");
        var q = queue;
        if (q == null) { evt = null!; return HRESULTS.MF_E_SHUTDOWN; }
        return q.Object.GetEvent(flags, out evt);
    }

    public HRESULT BeginGetEvent(IMFAsyncCallback callback, object state)
    {
        Diag.Trace("Stream.BeginGetEvent");
        var q = queue;
        if (q == null) return HRESULTS.MF_E_SHUTDOWN;
        return q.Object.BeginGetEvent(callback, state);
    }

    public HRESULT EndGetEvent(IMFAsyncResult result, out IMFMediaEvent evt)
    {
        Diag.Trace("Stream.EndGetEvent");
        var q = queue;
        if (q == null) { evt = null!; return HRESULTS.MF_E_SHUTDOWN; }
        return q.Object.EndGetEvent(result, out evt);
    }

    public HRESULT QueueEvent(uint type, Guid extendedType, HRESULT hrStatus, PROPVARIANT value)
    {
        Diag.Trace("Stream.QueueEvent");
        var q = queue;
        if (q == null) return HRESULTS.MF_E_SHUTDOWN;
        return q.Object.QueueEventParamVar(type, extendedType, hrStatus, value);
    }
    public HRESULT KsProperty(ref KSIDENTIFIER property, uint propertyLength, nint propertyData, uint dataLength, out uint bytesReturned) { Diag.Trace("Stream.KsProperty"); bytesReturned = 0; return HRESULTS.E_NOTIMPL; }
    public HRESULT KsMethod(ref KSIDENTIFIER method, uint methodLength, nint methodData, uint dataLength, out uint bytesReturned) { Diag.Trace("Stream.KsMethod"); bytesReturned = 0; return HRESULTS.E_NOTIMPL; }
    public HRESULT KsEvent(ref KSIDENTIFIER evt, uint eventLength, nint eventData, uint dataLength, out uint bytesReturned) { Diag.Trace("Stream.KsEvent"); bytesReturned = 0; return HRESULTS.E_NOTIMPL; }

    public void Shutdown() { EndHighResTimer(); queue?.Dispose(); queue = null; descriptor?.Dispose(); descriptor = null; DisposeAttributes(); }
}
