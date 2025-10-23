# Script de limpieza de puertos para Windows
# Sistema LAMDA - Sincronizador de Etiquetas

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  LIMPIEZA DE PUERTOS - Sistema LAMDA" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

# Lista de puertos que usa el proyecto
$puertos = @(3000, 3002, 3003, 3004)

# Liberar cada puerto
foreach ($puerto in $puertos) {
    Write-Host "Verificando puerto $puerto..." -ForegroundColor Yellow
    
    try {
        # Buscar el proceso que está usando el puerto
        $conexiones = Get-NetTCPConnection -LocalPort $puerto -ErrorAction SilentlyContinue
        
        if ($conexiones) {
            foreach ($conexion in $conexiones) {
                $procesoId = $conexion.OwningProcess
                
                if ($procesoId -and $procesoId -gt 0) {
                    try {
                        $proceso = Get-Process -Id $procesoId -ErrorAction SilentlyContinue
                        
                        if ($proceso) {
                            Write-Host "  -> Deteniendo proceso: $($proceso.ProcessName) (PID: $procesoId)" -ForegroundColor Red
                            Stop-Process -Id $procesoId -Force -ErrorAction SilentlyContinue
                            Write-Host "  [OK] Proceso detenido exitosamente" -ForegroundColor Green
                        }
                    }
                    catch {
                        Write-Host "  [ERROR] No se pudo detener el proceso $procesoId" -ForegroundColor Red
                    }
                }
            }
        } else {
            Write-Host "  [OK] Puerto $puerto esta libre" -ForegroundColor Green
        }
    }
    catch {
        Write-Host "  [OK] Puerto $puerto esta libre" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  Limpieza completada" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

# Esperar un momento para asegurar que los puertos se liberaron
Start-Sleep -Seconds 2

Write-Host "Puertos listos para usar. Iniciando servicios..." -ForegroundColor Green
Write-Host ""
