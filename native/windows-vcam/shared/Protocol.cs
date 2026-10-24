using System;
using System.Buffers.Binary;

namespace BipCam.VirtualCamera;

public static class Protocol
{
    public const int HeaderSize = 28;
    public const uint Magic = 0x4D434942;
    public const ushort Version = 1;

    public static void WriteHeader(Span<byte> data, int width, int height, int stride, int fps, int payloadBytes, long timestamp)
    {
        BinaryPrimitives.WriteUInt32LittleEndian(data.Slice(0, 4), Magic);
        BinaryPrimitives.WriteUInt16LittleEndian(data.Slice(4, 2), Version);
        BinaryPrimitives.WriteUInt16LittleEndian(data.Slice(6, 2), 0);
        BinaryPrimitives.WriteInt32LittleEndian(data.Slice(8, 4), width);
        BinaryPrimitives.WriteInt32LittleEndian(data.Slice(12, 4), height);
        BinaryPrimitives.WriteInt32LittleEndian(data.Slice(16, 4), stride);
        BinaryPrimitives.WriteInt32LittleEndian(data.Slice(20, 4), fps);
        BinaryPrimitives.WriteInt32LittleEndian(data.Slice(24, 4), payloadBytes);
    }
}
