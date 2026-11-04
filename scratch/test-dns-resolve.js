const dns = require('dns');

dns.resolve4('google.com', (err, addresses) => {
  if (err) {
    console.error('❌ Failed to resolve google.com:', err);
  } else {
    console.log('✅ Resolved google.com:', addresses);
  }
});

dns.resolve6('db.zysyxtbcvgswancxtpib.supabase.co', (err, addresses) => {
  if (err) {
    console.error('❌ Failed to resolve db.zysyxtbcvgswancxtpib.supabase.co:', err);
  } else {
    console.log('✅ Resolved db.zysyxtbcvgswancxtpib.supabase.co:', addresses);
  }
});
