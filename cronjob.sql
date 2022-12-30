select cron.schedule (
    'Update monitored parcels every 31 minutes', -- name of the cron job
    '*/31 * * * *', -- every 31st minute
    $$ SELECT status, content::json
  FROM http((
          'POST',
           'https://qwertyuiop.functions.supabase.co/parcel-monitor', --- replace this with your parcel-monitor function's URL
           ARRAY[http_header('Authorization','Bearer XXXXXXXXX')], --- replace the XXXXXXXXX with your service_role api key
           'application/json',
           '{}'
        )::http_request)
      $$
);
