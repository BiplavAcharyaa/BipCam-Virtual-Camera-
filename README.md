# BipCam

BipCam turns an Android phone into a wireless Windows webcam over the local network.

## Architecture

Android Chrome camera + microphone -> WebRTC -> BipCam Electron -> processed video -> Windows 11 Media Foundation virtual camera -> Windows camera clients.

The desktop application remains Electron/Node.js/React/TypeScript. The Windows virtual-camera part is isolated under `native/windows-vcam`.

The native component uses the Windows 11 Media Foundation virtual-camera API (`MFCreateVirtualCamera`) and a COM-hosted custom Media Foundation source. The source exposes **NV12** (preferred by Teams/Zoom/Meet/WhatsApp/Chrome) and RGB32 modes from 360p up to 1080p/60. Frames of any size or orientation are scaled to fit the mode the app negotiated (portrait phones are pillar-boxed rather than cropped). BipCam publishes the currently received processed desktop-preview frames to a loopback TCP bridge on `127.0.0.1:38721`; the Media Foundation source requests the latest frame when Windows asks for a sample.

## Requirements

### Runtime

- Windows 11 Build 22000 or later for the virtual-camera feature.
- Android phone and Windows laptop on the same Wi-Fi network.
- A current Android browser with camera and microphone support.

### Quick start (Windows)

Double-click **`BipCam.bat`**.

- First run: installs Node.js and the .NET 10 SDK if they are missing (via winget), then runs `npm install`.
- Every run: `npm run build:vcam`, then `npm run dev`.
- To repeat the first-time setup, delete `node_modules\.bipcam-ready`.

## Development

- Node.js 20+
- npm
- .NET 10 SDK only when building the isolated Windows virtual-camera component.

### End-user machine (virtual camera)

- **.NET 10 Runtime (x64)** must be installed. The camera source is a .NET COM server that Windows Frame Server loads, and .NET COM hosting cannot be fully self-contained. The installer warns if it is missing.

The installer contains the published native component; the end user needs the .NET 10 Runtime (x64) but not Node.js, Visual Studio, CMake, MSBuild or PowerShell.

## Development

```bash
npm install
npm run dev
```

On Windows, if the virtual-camera binaries have already been built into `native/windows-vcam/dist`, BipCam can start and control the virtual camera from the Electron UI. The normal WebRTC camera pipeline does not depend on the virtual-camera component.

## Build the Windows virtual-camera component

Run this on Windows with the .NET 10 SDK installed:

```bash
npm run build:vcam
```

This creates the isolated COM source and controller under `native/windows-vcam/dist`.

## Package the Windows installer

```bash
npm run package
```

`npm run package` builds the Electron application, publishes the Windows virtual-camera component, and creates the NSIS installer.

The installer registers the Media Foundation source and starts the `BipCam Camera` virtual camera. Installation is elevated because the COM media source must be registered for Windows Frame Server access. Windows 11 automatically identifies the device as a software virtual camera.

## Virtual camera

The desktop UI exposes:

- Virtual Camera status
- BipCam Camera friendly name
- Start Virtual Camera
- Stop Virtual Camera
- Start Virtual Camera Automatically

When running, the camera is registered through `MFCreateVirtualCamera` using `MFVirtualCameraType_SoftwareCameraSource`, system lifetime, and current-user access. Windows automatically identifies software cameras as virtual cameras in the friendly name.

When BipCam has no video frame available, the Media Foundation source supplies a black frame instead of crashing or returning an invalid media sample.

## Testing

1. Install BipCam on Windows 11.
2. Open BipCam.
3. Pair the Android phone with the displayed code or QR URL.
4. Grant camera and microphone permissions.
5. Start the phone camera.
6. Click `Start Virtual Camera`.
7. Open Windows Camera and select `BipCam Camera`.
8. Open Teams -> Settings -> Devices -> Camera and select `BipCam Camera`.
9. Test Zoom, OBS and a browser camera page independently.

The camera is a system-wide Windows video device; the Electron preview is not used as the webcam output.

## Windows permissions

The virtual-camera source is registered for the Windows Frame Server services. The installer therefore requires administrator permission. The BipCam application itself continues to run as a normal desktop application.

Windows camera privacy settings still apply. If Windows camera access is disabled, enable camera access under Windows Settings -> Privacy & security -> Camera.

## Picture quality and frame rate

- The phone page never rotates the picture. If the phone delivers a portrait frame and *Landscape* is selected (or the reverse), a centred 16:9 / 9:16 window is cropped out instead. Hold the phone sideways (auto-rotate on) to use the full sensor.
- Every camera the phone exposes is listed under *Lens* (Back camera 1, 2, 3 ...). *Switch Camera* steps through all of them. A *Zoom* slider appears when the camera supports it.
- The encoder starts at a high bitrate (6 to 20 Mbit/s depending on resolution and frame rate) and prefers H.264 (hardware encoder on the phone); *Codec* can be switched to VP8 / VP9.
- *Actual FPS* and *Encoder* on the phone are measured values, not the requested ones.
- Windows apps choose the camera mode themselves. Teams / Zoom / WhatsApp normally ask for 30 FPS; 60 FPS shows up in apps that request it (Windows Camera, OBS, browsers).

## Limitations

- Media Foundation virtual cameras require Windows 11 Build 22000 or later.
- Actual 1080p/60 capability depends on the Android camera/browser and the WebRTC connection.
- Background segmentation can reduce available frame rate on lower-powered phones.
- The virtual-camera bridge uses CPU BGRA frame copies between Chromium and the Windows Media Foundation source. This is deliberately isolated and simple; GPU/shared-surface optimization can be added later without changing the Electron/WebRTC architecture.
- The virtual camera is video-only. The existing phone microphone remains a WebRTC audio stream and is not registered as a Windows system microphone by this component.

## Camera settings

- **Orientation** Landscape / Portrait. The phone rotates frames as needed no matter how the phone is held.
- **Mirror (selfie)** *Auto* mirrors only the front camera (what you see when looking in a mirror), *Always mirror* / *No mirror* force it. The mirroring is applied on the phone, so it also reaches the Windows virtual camera.
- **Background blur** Uses MediaPipe Selfie Segmentation on the phone. Changing blur/mirror/orientation no longer restarts the camera or the WebRTC connection.

## Troubleshooting the virtual camera

1. Press **Start Virtual Camera** once. If the camera source is not registered yet, Windows asks for administrator permission (only the first time). `npm run vcam:register` does the same manually.
2. Make sure the **.NET 10 Runtime (x64)** is installed.
3. Start the phone camera - the virtual camera shows black until the first frame arrives.
4. Fully quit and reopen Teams / Zoom / Chrome after the first registration so they re-enumerate cameras.
5. Keep the phone screen on and the browser in the foreground; Android suspends the camera otherwise.
