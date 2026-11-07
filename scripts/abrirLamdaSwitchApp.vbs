Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

appDir = "c:\Users\Martin\Documents\sincronizador-etiquetas - copia"
WshShell.CurrentDirectory = appDir

' 1. Asegurar que el servidor de la Mini-App (3098) y el Puente Zebra (3099) estén activos en segundo plano (Modo 0 = Oculto, sin ventana negra)
WshShell.Run "node """ & appDir & "\scripts\lamdaSwitchGuiServer.js""", 0, False
WScript.Sleep 900

' 2. Abrir la Mini-Aplicación Visual de LAMDA sin barra de direcciones
chromePath1 = "C:\Program Files\Google\Chrome\Application\chrome.exe"
chromePath2 = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

If fso.FileExists(chromePath1) Then
    WshShell.Run """" & chromePath1 & """ --app=http://127.0.0.1:3098 --window-size=720,760", 1, False
ElseIf fso.FileExists(chromePath2) Then
    WshShell.Run """" & chromePath2 & """ --app=http://127.0.0.1:3098 --window-size=720,760", 1, False
ElseIf fso.FileExists(edgePath) Then
    WshShell.Run """" & edgePath & """ --app=http://127.0.0.1:3098 --window-size=720,760", 1, False
Else
    WshShell.Run "http://127.0.0.1:3098", 1, False
End If
