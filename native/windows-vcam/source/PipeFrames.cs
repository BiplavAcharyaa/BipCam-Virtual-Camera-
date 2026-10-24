using System;
using System.IO;
using System.Net.Sockets;
using System.Runtime.CompilerServices;
using System.Threading.Tasks;

namespace BipCam.VirtualCamera.Source;

/// <summary>
/// Pulls the latest BGRA frame from the BipCam desktop app (loopback TCP) and renders it into the
/// exact mode negotiated by the Windows camera client. Frames of any size / orientation are
/// scaled to fit (letterbox / pillarbox) so portrait and landscape both display correctly.
/// </summary>
internal static class PipeFrames
{
    private const int Port = 38721;
    private const int ConnectTimeoutMilliseconds = 400;
    private const int ReadTimeoutMilliseconds = 1500;
    private const int WriteTimeoutMilliseconds = 500;
    private const int ReconnectBackoffMilliseconds = 1000;
    private const long StaleAfterMilliseconds = 3000;

    private static readonly object Gate = new();
    private static readonly byte[] Header = new byte[Protocol.HeaderSize];

    private static TcpClient? client;
    private static NetworkStream? stream;
    private static long nextConnectAttempt;

    private static byte[] payload = Array.Empty<byte>();
    private static int frameWidth;
    private static int frameHeight;
    private static int frameStride;
    private static bool haveFrame;
    private static long lastFrameTick;

    private static int[] xMap = Array.Empty<int>();
    private static int xMapTarget;
    private static int xMapSource;

    // ---------------------------------------------------------------- public API

    public static unsafe void RenderBgra(nint destination, int pitch, int width, int height)
    {
        lock (Gate)
        {
            var useFrame = Refresh();
            var dst = (byte*)destination;
            if (pitch <= 0 || width <= 0 || height <= 0) return;

            for (var y = 0; y < height; y++)
                new Span<byte>(dst + (long)y * pitch, width * 4).Clear();
            if (!useFrame) return;

            Fit(width, height, out var ox, out var oy, out var tw, out var th);
            BuildMap(tw, frameWidth);
            fixed (byte* src = payload)
            fixed (int* map = xMap)
            {
                for (var y = 0; y < th; y++)
                {
                    var sy = (int)((long)y * frameHeight / th);
                    var s = (uint*)(src + (long)sy * frameStride);
                    var d = (uint*)(dst + (long)(oy + y) * pitch + (long)ox * 4);
                    for (var x = 0; x < tw; x++) d[x] = s[map[x]] | 0xFF000000u;
                }
            }
        }
    }

    private static readonly ParallelOptions Parallelism = new() { MaxDegreeOfParallelism = Math.Max(2, Math.Min(4, Environment.ProcessorCount)) };

    public static unsafe void RenderNv12(nint destination, int pitch, int width, int height)
    {
        lock (Gate)
        {
            var useFrame = Refresh();
            if (pitch <= 0 || width <= 0 || height <= 0) return;
            var yPlane = (byte*)destination;
            var uvPlane = yPlane + (long)pitch * height;

            var ox = 0;
            var oy = 0;
            var tw = 0;
            var th = 0;
            var covers = false;
            if (useFrame)
            {
                Fit(width, height, out ox, out oy, out tw, out th);
                covers = tw == width && th == height;
            }

            // Black borders (letterbox / pillarbox) only need painting when the picture does not fill the whole mode.
            if (!covers)
            {
                for (var y = 0; y < height; y++)
                    new Span<byte>(yPlane + (long)y * pitch, width).Fill(16);
                for (var y = 0; y < height / 2; y++)
                    new Span<byte>(uvPlane + (long)y * pitch, width).Fill(128);
            }
            if (!useFrame) return;

            // 1:1 (frame size == mode size) is the common case for 720p / 1080p and needs no scaling at all.
            var oneToOne = tw == frameWidth && th == frameHeight;
            if (!oneToOne) BuildMap(tw, frameWidth);

            var dstY = (nint)yPlane;
            var dstUv = (nint)uvPlane;
            var stride = frameStride;
            var srcH = frameHeight;
            var pairs = th / 2;

            fixed (byte* src = payload)
            fixed (int* map = xMap)
            {
                var srcBase = (nint)src;
                var mapBase = (nint)map;
                // Two output rows at a time (they share one chroma row); each pair is independent, so rows run in parallel.
                // This is what makes 1080p60 affordable: the old single-threaded per-pixel loop could not keep up.
                Parallel.For(0, pairs, Parallelism, pair =>
                {
                    var y0 = pair * 2;
                    var y1 = y0 + 1;
                    var dy0 = (byte*)dstY + (long)(oy + y0) * pitch + ox;
                    var dy1 = dy0 + pitch;
                    var duv = (byte*)dstUv + (long)((oy + y0) >> 1) * pitch + ox;
                    if (oneToOne)
                    {
                        var s0 = (uint*)((byte*)srcBase + (long)y0 * stride);
                        var s1 = (uint*)((byte*)srcBase + (long)y1 * stride);
                        for (var x = 0; x < tw; x += 2)
                            ConvertBlock(s0[x], s0[x + 1], s1[x], s1[x + 1], dy0 + x, dy1 + x, duv + x);
                    }
                    else
                    {
                        var sy0 = (int)((long)y0 * srcH / th);
                        var sy1 = (int)((long)y1 * srcH / th);
                        var s0 = (uint*)((byte*)srcBase + (long)sy0 * stride);
                        var s1 = (uint*)((byte*)srcBase + (long)sy1 * stride);
                        var m = (int*)mapBase;
                        for (var x = 0; x < tw; x += 2)
                        {
                            var a = m[x];
                            var b = m[x + 1];
                            ConvertBlock(s0[a], s0[b], s1[a], s1[b], dy0 + x, dy1 + x, duv + x);
                        }
                    }
                });
            }
        }
    }

    /// <summary>Converts a 2x2 block of BGRA pixels to 4 luma samples plus one averaged U/V pair (BT.601, limited range).</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static unsafe void ConvertBlock(uint p00, uint p01, uint p10, uint p11, byte* y0, byte* y1, byte* uv)
    {
        y0[0] = Luma(p00);
        y0[1] = Luma(p01);
        y1[0] = Luma(p10);
        y1[1] = Luma(p11);
        var r = (int)((p00 >> 16) & 0xFF) + (int)((p01 >> 16) & 0xFF) + (int)((p10 >> 16) & 0xFF) + (int)((p11 >> 16) & 0xFF);
        var g = (int)((p00 >> 8) & 0xFF) + (int)((p01 >> 8) & 0xFF) + (int)((p10 >> 8) & 0xFF) + (int)((p11 >> 8) & 0xFF);
        var b = (int)(p00 & 0xFF) + (int)(p01 & 0xFF) + (int)(p10 & 0xFF) + (int)(p11 & 0xFF);
        r = (r + 2) >> 2;
        g = (g + 2) >> 2;
        b = (b + 2) >> 2;
        uv[0] = (byte)(((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128);
        uv[1] = (byte)(((112 * r - 94 * g - 18 * b + 128) >> 8) + 128);
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static byte Luma(uint p) =>
        (byte)(((66 * (int)((p >> 16) & 0xFF) + 129 * (int)((p >> 8) & 0xFF) + 25 * (int)(p & 0xFF) + 128) >> 8) + 16);

    // ---------------------------------------------------------------- helpers

    private static void Fit(int dw, int dh, out int ox, out int oy, out int tw, out int th)
    {
        var scale = Math.Min((double)dw / frameWidth, (double)dh / frameHeight);
        tw = Math.Max(2, ((int)(frameWidth * scale)) & ~1);
        th = Math.Max(2, ((int)(frameHeight * scale)) & ~1);
        tw = Math.Min(tw, dw & ~1);
        th = Math.Min(th, dh & ~1);
        ox = ((dw - tw) / 2) & ~1;
        oy = ((dh - th) / 2) & ~1;
    }

    private static void BuildMap(int target, int source)
    {
        if (xMapTarget == target && xMapSource == source && xMap.Length == target) return;
        xMap = new int[target];
        for (var x = 0; x < target; x++) xMap[x] = (int)((long)x * source / target);
        xMapTarget = target;
        xMapSource = source;
    }

    /// <summary>Fetches a new frame if one is available. Returns true when a usable frame is cached.</summary>
    private static bool Refresh()
    {
        try
        {
            EnsureConnected();
            if (stream != null)
            {
                stream.WriteByte(1);
                stream.Flush();
                if (!ReadExact(Header, Header.Length)) { Reset(); return HasUsableFrame(); }
                var magic = BitConverter.ToUInt32(Header, 0);
                var version = BitConverter.ToUInt16(Header, 4);
                var w = BitConverter.ToInt32(Header, 8);
                var h = BitConverter.ToInt32(Header, 12);
                var stride = BitConverter.ToInt32(Header, 16);
                var bytes = BitConverter.ToInt32(Header, 24);
                if (magic != Protocol.Magic || version != Protocol.Version) { Reset(); return HasUsableFrame(); }
                if (bytes > 0)
                {
                    if (w <= 0 || h <= 0 || stride < w * 4 || bytes < stride * h || bytes > 64 * 1024 * 1024)
                    { Reset(); return HasUsableFrame(); }
                    if (payload.Length != bytes) payload = new byte[bytes];
                    if (!ReadExact(payload, bytes)) { Reset(); return HasUsableFrame(); }
                    frameWidth = w;
                    frameHeight = h;
                    frameStride = stride;
                    haveFrame = true;
                    lastFrameTick = Environment.TickCount64;
                }
                // bytes == 0 means "no new frame since your last request": keep the cached one.
            }
        }
        catch
        {
            Reset();
        }
        return HasUsableFrame();
    }

    private static bool HasUsableFrame() =>
        haveFrame && frameWidth > 0 && frameHeight > 0 && Environment.TickCount64 - lastFrameTick < StaleAfterMilliseconds;

    private static void EnsureConnected()
    {
        if (client is { Connected: true } && stream != null) return;
        var now = Environment.TickCount64;
        if (now < nextConnectAttempt) return;
        Reset();
        try
        {
            var c = new TcpClient { NoDelay = true };
            var task = c.ConnectAsync("127.0.0.1", Port);
            if (!task.Wait(ConnectTimeoutMilliseconds) || !c.Connected)
            {
                c.Dispose();
                nextConnectAttempt = Environment.TickCount64 + ReconnectBackoffMilliseconds;
                return;
            }
            client = c;
            stream = c.GetStream();
            stream.ReadTimeout = ReadTimeoutMilliseconds;
            stream.WriteTimeout = WriteTimeoutMilliseconds;
            nextConnectAttempt = 0;
        }
        catch
        {
            Reset();
            nextConnectAttempt = Environment.TickCount64 + ReconnectBackoffMilliseconds;
        }
    }

    private static void Reset()
    {
        try { stream?.Dispose(); } catch { }
        try { client?.Dispose(); } catch { }
        stream = null;
        client = null;
        nextConnectAttempt = Environment.TickCount64 + ReconnectBackoffMilliseconds;
    }

    private static bool ReadExact(byte[] data, int count)
    {
        if (stream == null) return false;
        var read = 0;
        while (read < count)
        {
            var n = stream.Read(data, read, count - read);
            if (n <= 0) return false;
            read += n;
        }
        return true;
    }
}
