drop policy "Enable delete for authenticated users based on user_id" on "public"."parcels_monitoring";

drop policy "Enable insert for authenticated users only" on "public"."parcels_monitoring";

drop policy "Enable read access for authenticated users and based on user_id" on "public"."parcels_monitoring";

drop type "public"."events_history";

alter table "public"."parcels_monitoring" alter column "carrier_id" set not null;

alter table "public"."parcels_monitoring" alter column "last_updated" set not null;

alter table "public"."parcels_monitoring" alter column "tracking_id" set not null;

alter table "public"."parcels_monitoring" alter column "user_id" set not null;


