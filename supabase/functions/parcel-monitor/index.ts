// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient, PostgrestResponse } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from "../helpers/cors.ts"
import * as sleep from "https://deno.land/x/sleep@v1.2.1/mod.ts";
import axiod from "https://deno.land/x/axiod/mod.ts";

interface IEventsHistory {
  status: string,
  statusId: number,
  county: string,
  country?: string | null,
  statusDate: Date
}

interface IRes {
  awbNumber: string,
  status: string,
  statusId: number,
  eventsHistory: IEventsHistory[]
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // const { name } = await req.json()
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? '', Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? '', { global: { headers: { Authorization: req.headers.get('Authorization')! } } })
    const thirtyMinutesBefore = new Date();
    thirtyMinutesBefore.setMinutes(thirtyMinutesBefore.getMinutes() - 30);
    
    const {data, error} = await supabase.from("parcels_monitoring").select("tracking_id, carrier_id(id, name), user_id, count_events").lte( "last_updated", thirtyMinutesBefore.toISOString()) as PostgrestResponse<{tracking_id: string, carrier_id: {id: string, name: string}, user_id: string, count_events: number}>
    
    if (error) {
      throw error
    }
    
    if (data && data.length > 0) {
      for await (const el of data) {
        // console.log(el);
        const { data: dataF, error } = await supabase.functions.invoke<IRes>("trace-parcel", { body: { tracking_id: el.tracking_id, carrier_id: el.carrier_id.id } })
        error && console.log(error);
        const { error: errorI } = await supabase.from("parcels_monitoring").update({ statusId: dataF?.statusId, last_updated: new Date() }).eq("tracking_id", el.tracking_id)
        if (errorI) {
          console.log(errorI);
        }
        if (dataF && el.count_events < dataF?.eventsHistory.length) {
          await axiod.post(`https://ntfy.kodeeater.xyz/parcel-romania-${el.user_id.slice(0, 8)}`, `${el.carrier_id.name} \n ${el.tracking_id} - ${dataF?.status}, ${dataF?.eventsHistory[0].county}`)
          if (dataF.statusId == 99 || dataF.statusId == 255) {
            const { error: errorL } = await supabase.from("parcels_monitoring").delete().eq("tracking_id", el.tracking_id)
            if (errorL) {
              console.log(errorL);
            }
          } else {
            const { error: errorL } = await supabase.from("parcels_monitoring").update({ count_events: dataF?.eventsHistory.length }).eq("tracking_id", el.tracking_id)
            if (errorL) {
              console.log(errorL);
            }
          }
        }
        // console.log(res.data);
        await sleep.sleepRandomAmountOfSeconds(1, 4);
      }
      // for (let i = 0; i < data.length; i++) {
      //   const { data: dataF, error } = await supabase.functions.invoke<IRes>("trace-parcel", { body: { tracking_id: data[i].tracking_id, carrier_id: data[i].carrier_id.id } })
      //   error && console.log(error);
      //   const { error: errorI } = await supabase.from("parcels_monitoring").update({ statusId: dataF?.statusId, last_updated: new Date() }).eq("tracking_id", data[i].tracking_id)
      //   if (errorI) {
      //     console.log(errorI);
      //   }
      //   await axiod.post(`https://ntfy.kodeeater.xyz/parcel-romania-${data[i].user_id.slice(0, 8)}`, `${data[i].carrier_id.name} \n ${data[i].tracking_id} - ${dataF?.status}, ${dataF?.eventsHistory[0].county}`)
      //   // console.log(res.data);
        
      //   await sleep.sleepRandomAmountOfSeconds(1, 5);
      // };
    }
    return new Response(
      JSON.stringify(data),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    )
  } catch (error) {
    console.log(error);

    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }

})

// To invoke:
// curl -i --location --request POST 'http://localhost:54321/functions/v1/' \
//   --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
//   --header 'Content-Type: application/json' \
//   --data '{"name":"Functions"}'
