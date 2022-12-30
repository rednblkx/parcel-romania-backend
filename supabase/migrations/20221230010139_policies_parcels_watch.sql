create policy "Enable delete for authenticated users based on user_id"
on "public"."parcels_monitoring"
as permissive
for delete
to authenticated
using ((auth.uid() = user_id));


create policy "Enable insert for authenticated users only"
on "public"."parcels_monitoring"
as permissive
for insert
to authenticated
with check ((auth.uid() = user_id));


create policy "Enable read access for authenticated users and based on user_id"
on "public"."parcels_monitoring"
as permissive
for select
to authenticated
using ((auth.uid() = user_id));