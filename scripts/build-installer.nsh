!include "x64.nsh"

!macro customInstall
  ; The NSIS installer is a 32-bit process. Without disabling file-system redirection,
  ; "$SYSDIR\regsvr32.exe" resolves to the 32-bit regsvr32 which cannot load the 64-bit COM host,
  ; so the virtual-camera source was silently never registered (camera invisible / not working in apps).
  SetOutPath "$INSTDIR\resources\native"
  ${If} ${RunningX64}
    ${DisableX64FSRedirection}
    SetRegView 64
  ${EndIf}

  IfFileExists "$PROGRAMFILES64\dotnet\shared\Microsoft.NETCore.App\10.*\*.*" +2 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "BipCam's virtual camera needs the .NET 10 Runtime (x64).$\r$\nInstall it from https://dotnet.microsoft.com/download/dotnet/10.0 and then restart BipCam."

  nsExec::ExecToLog '"$SYSDIR\regsvr32.exe" /s "$INSTDIR\resources\native\BipCamVirtualCameraSource.comhost.dll"'
  nsExec::ExecToLog '"$INSTDIR\resources\native\BipCamVirtualCameraControl.exe" start'

  ${If} ${RunningX64}
    SetRegView 32
    ${EnableX64FSRedirection}
  ${EndIf}
!macroend

!macro customUnInstall
  ${If} ${RunningX64}
    ${DisableX64FSRedirection}
    SetRegView 64
  ${EndIf}
  nsExec::ExecToLog '"$INSTDIR\resources\native\BipCamVirtualCameraControl.exe" remove'
  nsExec::ExecToLog '"$SYSDIR\regsvr32.exe" /u /s "$INSTDIR\resources\native\BipCamVirtualCameraSource.comhost.dll"'
  ${If} ${RunningX64}
    SetRegView 32
    ${EnableX64FSRedirection}
  ${EndIf}
!macroend
