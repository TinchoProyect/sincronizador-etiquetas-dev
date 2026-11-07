Set WshShell = CreateObject("WScript.Shell")
appDir = "c:\Users\Martin\Documents\sincronizador-etiquetas - copia"
WshShell.CurrentDirectory = appDir
WshShell.Run "node """ & appDir & "\scripts\lanzadorInteligenteLamda.js""", 0, False
