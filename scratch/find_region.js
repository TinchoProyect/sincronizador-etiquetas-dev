const dns = require('dns');

async function main() {
  const domain = 'zysyxtbcvgswancxtpib.supabase.co';
  
  dns.resolveCname(domain, (err, addresses) => {
    if (err) {
      console.log('CNAME lookup failed, resolving standard A records...');
      dns.resolve(domain, (err2, ips) => {
        if (err2) {
          console.error(err2);
        } else {
          console.log('IPs:', ips);
        }
      });
    } else {
      console.log('CNAME Addresses:', addresses);
    }
  });
}

main();
