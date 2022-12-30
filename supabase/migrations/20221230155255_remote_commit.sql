alter table "public"."parcels_monitoring" add column "last_updated" timestamp with time zone not null default now();

alter table "public"."parcels_monitoring" add column "statusId" bigint not null default '99'::bigint;

alter table "public"."parcels_monitoring" alter column "carrier_id" set not null;

alter table "public"."parcels_monitoring" alter column "tracking_id" set not null;

alter table "public"."parcels_monitoring" alter column "user_id" set not null;


