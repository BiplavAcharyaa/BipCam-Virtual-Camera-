using System;
using DirectN;

namespace BipCam.VirtualCamera.Source;

public abstract class AttributesBase : IMFAttributes
{
    private readonly IMFAttributes attributes;

    protected AttributesBase(uint initialSize = 16)
    {
        MFFunctions.MFCreateAttributes(out attributes, initialSize).ThrowOnError();
    }

    protected IMFAttributes AttributeStore => attributes;

    public HRESULT GetItem(Guid guidKey, PROPVARIANT value) { Diag.Trace(GetType().Name + ".GetItem"); return attributes.GetItem(guidKey, value); }
    public HRESULT GetItemType(Guid guidKey, out _MF_ATTRIBUTE_TYPE type) { Diag.Trace(GetType().Name + ".GetItemType"); return attributes.GetItemType(guidKey, out type); }
    public HRESULT CompareItem(Guid guidKey, PROPVARIANT value, out bool result) { Diag.Trace(GetType().Name + ".CompareItem"); return attributes.CompareItem(guidKey, value, out result); }
    public HRESULT Compare(IMFAttributes other, _MF_ATTRIBUTES_MATCH_TYPE matchType, out bool result) { Diag.Trace(GetType().Name + ".Compare"); return attributes.Compare(other, matchType, out result); }
    public HRESULT GetUINT32(Guid guidKey, out uint value) { Diag.Trace(GetType().Name + ".GetUINT32"); return attributes.GetUINT32(guidKey, out value); }
    public HRESULT GetUINT64(Guid guidKey, out ulong value) { Diag.Trace(GetType().Name + ".GetUINT64"); return attributes.GetUINT64(guidKey, out value); }
    public HRESULT GetDouble(Guid guidKey, out double value) { Diag.Trace(GetType().Name + ".GetDouble"); return attributes.GetDouble(guidKey, out value); }
    public HRESULT GetGUID(Guid guidKey, out Guid value) { Diag.Trace(GetType().Name + ".GetGUID"); return attributes.GetGUID(guidKey, out value); }
    public HRESULT GetStringLength(Guid guidKey, out uint length) { Diag.Trace(GetType().Name + ".GetStringLength"); return attributes.GetStringLength(guidKey, out length); }
    public HRESULT GetString(Guid guidKey, string value, uint bufferSize, nint length) { Diag.Trace(GetType().Name + ".GetString"); return attributes.GetString(guidKey, value, bufferSize, length); }
    public HRESULT GetAllocatedString(Guid guidKey, nint value, out uint length) { Diag.Trace(GetType().Name + ".GetAllocatedString"); return attributes.GetAllocatedString(guidKey, value, out length); }
    public HRESULT GetBlobSize(Guid guidKey, out uint size) { Diag.Trace(GetType().Name + ".GetBlobSize"); return attributes.GetBlobSize(guidKey, out size); }
    public HRESULT GetBlob(Guid guidKey, byte[] buffer, int bufferSize, nint size) { Diag.Trace(GetType().Name + ".GetBlob"); return attributes.GetBlob(guidKey, buffer, bufferSize, size); }
    public HRESULT GetAllocatedBlob(Guid guidKey, out nint buffer, out uint size) { Diag.Trace(GetType().Name + ".GetAllocatedBlob"); return attributes.GetAllocatedBlob(guidKey, out buffer, out size); }
    public HRESULT GetUnknown(Guid guidKey, Guid riid, out object value) { Diag.Trace(GetType().Name + ".GetUnknown"); return attributes.GetUnknown(guidKey, riid, out value); }
    public HRESULT SetItem(Guid guidKey, PROPVARIANT value) { Diag.Trace(GetType().Name + ".SetItem"); return attributes.SetItem(guidKey, value); }
    public HRESULT DeleteItem(Guid guidKey) { Diag.Trace(GetType().Name + ".DeleteItem"); return attributes.DeleteItem(guidKey); }
    public HRESULT DeleteAllItems() { Diag.Trace(GetType().Name + ".DeleteAllItems"); return attributes.DeleteAllItems(); }
    public HRESULT SetUINT32(Guid guidKey, uint value) { Diag.Trace(GetType().Name + ".SetUINT32"); return attributes.SetUINT32(guidKey, value); }
    public HRESULT SetUINT64(Guid guidKey, ulong value) { Diag.Trace(GetType().Name + ".SetUINT64"); return attributes.SetUINT64(guidKey, value); }
    public HRESULT SetDouble(Guid guidKey, double value) { Diag.Trace(GetType().Name + ".SetDouble"); return attributes.SetDouble(guidKey, value); }
    public HRESULT SetGUID(Guid guidKey, Guid value) { Diag.Trace(GetType().Name + ".SetGUID"); return attributes.SetGUID(guidKey, value); }
    public HRESULT SetString(Guid guidKey, string value) { Diag.Trace(GetType().Name + ".SetString"); return attributes.SetString(guidKey, value); }
    public HRESULT SetBlob(Guid guidKey, byte[] buffer, int bufferSize) { Diag.Trace(GetType().Name + ".SetBlob"); return attributes.SetBlob(guidKey, buffer, bufferSize); }
    public HRESULT SetUnknown(Guid guidKey, object value) { Diag.Trace(GetType().Name + ".SetUnknown"); return attributes.SetUnknown(guidKey, value); }
    public HRESULT LockStore() { Diag.Trace(GetType().Name + ".LockStore"); return attributes.LockStore(); }
    public HRESULT UnlockStore() { Diag.Trace(GetType().Name + ".UnlockStore"); return attributes.UnlockStore(); }
    public HRESULT GetCount(out uint count) { Diag.Trace(GetType().Name + ".GetCount"); return attributes.GetCount(out count); }
    public HRESULT GetItemByIndex(uint index, out Guid guidKey, PROPVARIANT value) { Diag.Trace(GetType().Name + ".GetItemByIndex"); return attributes.GetItemByIndex(index, out guidKey, value); }
    public HRESULT CopyAllItems(IMFAttributes destination) { Diag.Trace(GetType().Name + ".CopyAllItems"); return attributes.CopyAllItems(destination); }

    protected void DisposeAttributes()
    {
        if (attributes is not null && System.Runtime.InteropServices.Marshal.IsComObject(attributes))
        {
            try { System.Runtime.InteropServices.Marshal.ReleaseComObject(attributes); } catch { }
        }
    }
}
