const { exec } = require('child_process');

function checkDevices() {
  const cmd = `powershell -Command "Get-PnpDevice | Where-Object { ($_.Class -eq 'WPD' -or $_.Class -eq 'AndroidUsbDeviceType' -or $_.FriendlyName -like '*Android*' -or $_.FriendlyName -like '*Galaxy*' -or $_.FriendlyName -like '*Motorola*' -or $_.FriendlyName -like '*Xiaomi*' -or $_.FriendlyName -like '*MTP*') -and $_.Status -eq 'OK' } | Select-Object FriendlyName, Class, Status, InstanceId | ConvertTo-Json"`;
  
  exec(cmd, (error, stdout, stderr) => {
    if (error) {
      console.error('Error:', error.message);
      return;
    }
    try {
      const data = JSON.parse(stdout || '[]');
      console.log('📱 Dispositivos detectados:', data);
    } catch (e) {
      console.log('Salida:', stdout);
    }
  });
}

checkDevices();
