// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

import { serve } from "https://deno.land/std@0.131.0/http/server.ts"
// import { createClient, PostgrestResponse } from 'https://esm.sh/@supabase/supabase-js@2'
import axiod from "https://deno.land/x/axiod/mod.ts";
import * as cheerio from "https://esm.sh/cheerio"
import { IAxiodResponse } from "https://deno.land/x/axiod/interfaces.ts";
import moment from "https://deno.land/x/momentjs@2.29.1-deno/mod.ts";
import { corsHeaders } from '../helpers/cors.ts'

const DELIVERED = 99;
const SAMEDAY_LOADED_LOCKER = 78;
const ON_DELIVERY = 5;
const IN_WAREHOUSE = 4;
const IN_TRANSIT = 3;
const PICKED_UP = 2;
const ORDER_CREATED = 1;
const CARGUS_WEIGHTING = 20;
const SAMEDAY_BUSY_LOCKER = 79;

interface IReq {
  tracking_id: string,
  carrier_id: number
}

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

interface ICarriers {
  id: number;
  name: string;
  created_at: string;
  active: boolean;
}

interface IFanCourier {
  EventId: string,
  Location: string,
  Date: Date,
  EventName: string,
}

interface IDPD {
  Data: string,
  Ora: string,
  "Status colet": string,
  "Oras/localitate": string
}

interface ICargusEvent {
  Date: Date,
  EventId: number,
  Description: string,
  LocalityName: string
}

interface ICargus {
  Code: string,
  Type: string,
  MeasuredWeight: number,
  VolumetricWeight: number,
  ConfirmationName: string,
  Observation: string,
  ResponseCode: string,
  Event: ICargusEvent[]
}

interface ISameDayError {
  code: number,
  message: string
}

interface ISameDayHistory {
  county: string,
  country: string,
  status: string,
  statusId: number,
  statusState: string,
  statusStateId: number,
  transitLocation: string,
  statusDate: Date
}

interface ISameDayHistoryParcels extends ISameDayHistory {
  parcelAwbNumber: string,
  createdBy: number,
  reasonId: string,
  reason: string,
  inReturn: boolean
}

interface ISameDay {
  error?: ISameDayError,
  awbNumber: string,
  awbHistory: ISameDayHistory[],
  parcelsList: Record<string, ISameDayHistoryParcels[]>
}

interface IGLSHistory {
  time: string,
  date: string,
  address: {
    city: string,
    countryCode?: string,
    countryName?: string
  },
  evtDscr: string,
  evtNo?: string
}

interface IGLS {
  lastError?: string,
  exceptionText?: string,
  tuStatus: [
    {
      history: IGLSHistory[]
      progressBar: {
        level: number,
        statusBar: {
          status: string,
          statusText: string,
          imageStatus: string,
          imageText: string
        }[],
        statusText: string,
        statusInfo: string,
        evtNos: string[],
        retourFlag: boolean,
        colourIndex: number
      },
      references: {
        type: string,
        name: string,
        value: string
      }[],
      signature: {
        validate: boolean,
        name: string,
        value: string
      },
      infos: {
        type: string,
        name: string,
        value: string
      }[],
      deliveryOwnerCode: string,
      owners: {
        type: string,
        code: string
      }[],
      changeDeliveryPossible: boolean,
      tuNo: string
    }
  ],
}

interface helper {
  [id: number]: {
    function: (tracking_id: string) => Promise<IRes | { error: string; }>,
    api: { uri: (tracking_id?: string) => string, headers?: { [key: string]: string | undefined }, payload?: (tracking_id: string) => string }
  }
}

const helper_object: helper = {
  1: { function: dpd, api: { uri: (tracking_id) => `https://tracking.dpd.ro/?shipmentNumber=${tracking_id}&language=ro`, headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36 Edg/107.0.1418.56" } } },
  2: { function: fanCourier, api: { uri: () => `https://www.selfawb.ro/awb_tracking_integrat.php`, payload: (tracking_id) => `username=${Deno.env.get("FAN_USERNAME")}&user_pass=${Deno.env.get("FAN_PASSWORD")}&client_id=${Deno.env.get("FAN_CLIENTID")}&AWB=${tracking_id}&display_mode=6`, headers: { 'Content-type': 'application/x-www-form-urlencoded' } } },
  3: { function: urgentcargus, api: { uri: (tracking_id) => `https://urgentcargus.azure-api.net/api/NoAuth/GetAwbTrace?barCode=${tracking_id}`, headers: { "Ocp-Apim-Subscription-Key": Deno.env.get("CARGUS_APIKEY") } } },
  4: { function: sameday, api: { uri: (tracking_id) => `https://api.sameday.ro/api/public/awb/${tracking_id}/awb-history?_locale=ro`, } },
  5: { function: gls, api: { uri: (tracking_id) => `https://gls-group.com/app/service/open/rest/RO/ro/rstt001?match=${tracking_id}&type=&caller=witt002&millis=${new Date()}`, headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36 Edg/107.0.1418.56" } } },
  6: { function: test, api: { uri: (tracking_id) => ""}}
}

async function dpd(tracking_id: string) {
  const { uri, headers } = helper_object[1].api
  const { data } = await axiod.get(uri(tracking_id), { headers: { ...headers } })
  const $ = cheerio.load(data);

  const header = [...$("table > tbody > tr > th").toArray()].map(a => $(a).text())
  if ($('.divErrorWaybill').toArray().length > 0) {
    const res: IRes = { awbNumber: tracking_id, status: $('.divErrorWaybill').text(), statusId: 255, eventsHistory: [] }
    return res
  }

  $(".aSignature").remove()

  const original_events = [...$("table > tbody > tr:not(:first-child)").toArray().map((el: any) => [...$("td", el).toArray()].map((a: any, i: number) => [header[i], $(a).text()])).map<IDPD>((a: any) => Object.fromEntries(a))];

  const refactored_obj: IRes = {
    awbNumber: tracking_id, status: original_events[original_events.length - 1]["Status colet"], statusId: 255, eventsHistory: original_events.map(obj => {
      const events_obj: IEventsHistory = { country: null, county: obj["Oras/localitate"], statusDate: new Date(moment(`${obj.Data} ${obj.Ora}`, "DD.MM.YYYY h:mm:ss").format()), status: obj["Status colet"], statusId: 255 };
      return events_obj;
    })
  }

  return refactored_obj;

}

async function fanCourier(tracking_id: string) {
  const { uri, payload, headers } = helper_object[2].api
  const { data } = await axiod.post<IFanCourier[]>(uri(), payload?.(tracking_id), { headers: { ...headers } })

  // if (data[0].EventId === "S0") {
  //   return {error: data[0].EventName}
  // }

  const status_id: { [id: string]: number } = {
    H3: ORDER_CREATED,
    H10: IN_TRANSIT,
    H1: IN_WAREHOUSE,
    S1: ON_DELIVERY,
    S2: DELIVERED,
    S0: 255
  }

  const refactored_obj: IRes = {
    awbNumber: tracking_id, status: data[data.length - 1].EventName, statusId: status_id[data[data.length - 1].EventId], eventsHistory: data.map(obj => {
      const events_obj: IEventsHistory = { country: null, county: obj.Location, statusDate: new Date(moment(obj.Date, "DD.MM.YYYY h:mm").format()), status: obj.EventName, statusId: status_id[obj.EventId] }
      return events_obj
    })
  }
  return refactored_obj;
}

async function urgentcargus(tracking_id: string) {
  const { uri, headers } = helper_object[3].api
  const { data } = await axiod.get<ICargus[]>(uri(tracking_id), { headers: { ...headers } })

  if (data.length == 0) {
    const res: IRes = { awbNumber: tracking_id, status: "AWB not valid or not yet received by the carrier", statusId: 255, eventsHistory: [] }
    return res
  }

  const status_id: { [id: number]: number } = {
    70: PICKED_UP,
    224: CARGUS_WEIGHTING,
    249: IN_WAREHOUSE,
    10: IN_WAREHOUSE,
    11: IN_TRANSIT,
    74: IN_WAREHOUSE,
    255: IN_WAREHOUSE,
    5: ON_DELIVERY,
    21: DELIVERED
  }

  const refactored_obj: IRes = {
    awbNumber: data[0].Code, status: data[0].Event[data[0].Event.length - 1].Description, statusId: status_id[data[0].Event[data[0].Event.length - 1].EventId], eventsHistory: data[0].Event.map(obj => {
      const events_obj: IEventsHistory = { country: null, county: obj.LocalityName, statusDate: new Date(obj.Date), status: obj.Description, statusId: status_id[obj.EventId] }
      return events_obj
    })
  }
  return refactored_obj;
}

async function sameday(tracking_id: string) {
  const { uri, headers } = helper_object[4].api
  const { data } = await axiod.get<ISameDay>(uri(tracking_id), { headers: { ...headers } })

  if (data.error) {
    const res: IRes = { awbNumber: tracking_id, status: data.error.message, statusId: 255, eventsHistory: [] }
    return res
  }

  const status_id: { [id: number]: number } = {
    9: DELIVERED,
    78: SAMEDAY_LOADED_LOCKER,
    33: ON_DELIVERY,
    6: IN_WAREHOUSE,
    56: IN_TRANSIT,
    7: IN_TRANSIT,
    99: SAMEDAY_BUSY_LOCKER,
    34: PICKED_UP,
    4: PICKED_UP,
    1: ORDER_CREATED
  }

  const refactored_obj: IRes = {
    awbNumber: data.awbNumber, status: data.awbHistory[0].status, statusId: status_id[data.awbHistory[0].statusId], eventsHistory: data.awbHistory.map(obj => {
      const events_obj: IEventsHistory = { country: obj.country, county: obj.county, statusDate: new Date(obj.statusDate), status: obj.status, statusId: status_id[obj.statusId] }
      return events_obj
    })
  }
  return refactored_obj;
}

function decodeHTMLEntities(text: string) {
  let $ = cheerio.load("<html><body><textarea></textarea></body></html>")
  return $("textarea").append(text).text()
}

async function gls(tracking_id: string) {
  const { uri, headers } = helper_object[5].api
  const { data } = await axiod.get<IGLS>(uri(tracking_id), { headers: { ...headers } })

  if (data.exceptionText) {
    const res: IRes = { awbNumber: tracking_id, status: data.exceptionText, statusId: 255, eventsHistory: [] }
    return res
  }

  const status_id: {
    [id: number]: number
  } = {
    1: ORDER_CREATED,
    0: PICKED_UP,
    10: IN_TRANSIT,
    20: IN_WAREHOUSE,
    110: ON_DELIVERY,
    30: DELIVERED
  }

  const refactored_obj: IRes = {
    awbNumber: data.tuStatus[0].tuNo, status: data.tuStatus[0].history[0].evtDscr, statusId: status_id[Number(data.tuStatus[0].history[0].evtNo) * 10] ?? status_id[Number(data.tuStatus[0].progressBar.evtNos[0]) * 10], eventsHistory: data.tuStatus[0].history.map((obj, i) => {
      const events_obj: IEventsHistory = { country: obj.address.countryName, county: obj.address.city, statusDate: new Date(`${obj.date} ${obj.time}`), status: decodeHTMLEntities(obj.evtDscr), statusId: status_id[Number(obj.evtNo) * 10] ?? status_id[Number(data.tuStatus[0].progressBar.evtNos[i]) * 10] }
      return events_obj
    })
  }
  return refactored_obj;
}

async function test(tracking_id: string) {
  let events_obj: IRes = {
    awbNumber: tracking_id, status: "Comanda expediata", statusId: 1, eventsHistory: [1,2,3,4,5,99].map(a => {return {county: "Here", status: "comanda expediata", statusDate: new Date(), statusId: a, country: "This"}})
  }

  return events_obj
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  try {
    const { tracking_id, carrier_id } = await req.json() as IReq
    
    return new Response(
      JSON.stringify(await helper_object[carrier_id].function(tracking_id)),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },

    )
  }

  catch (error) {
    console.log(error);

    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})