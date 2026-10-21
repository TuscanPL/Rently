-- Trips now keep each leg's stop coordinates and shape so the map can draw them.
-- Trips stored before that have neither; drop them and the app looks them up again.
delete from public.listing_routes;
