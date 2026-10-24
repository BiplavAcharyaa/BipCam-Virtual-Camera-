# BipCam Windows Virtual Camera Bridge

This component is isolated from the Electron application. The Electron/Node process remains the controller and publishes processed BGRA frames through a Windows named pipe. The Media Foundation virtual-camera media source runs inside Windows Frame Server and consumes those frames.

The virtual-camera API is Windows 11 Build 22000+ (`MFCreateVirtualCamera`). The source is registered as an in-process COM server because Windows Frame Server activates the source out of process from BipCam. The controller uses `MFVirtualCameraLifetime_System` so the camera registration can survive application restarts; the video source itself returns a neutral frame when BipCam is not publishing frames.

The source is implemented with .NET COM hosting and DirectN. No kernel camera driver is used.

A production Windows build should publish the source and controller as x64 self-contained .NET applications and place the source COM host in a machine-readable installation directory before registering it. Registration requires elevation because the Frame Server services need access to the COM server.
