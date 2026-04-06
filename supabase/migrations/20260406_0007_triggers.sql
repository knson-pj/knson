drop trigger if exists trg_profiles_role_guard on public.profiles;
create trigger trg_profiles_role_guard before insert or update on public.profiles for each row execute function public.enforce_profiles_role_guard();

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();

drop trigger if exists trg_assign_public_property_numbers on public.properties;
create trigger trg_assign_public_property_numbers before insert on public.properties for each row execute function public.assign_public_property_numbers();

drop trigger if exists trg_properties_staff_enforce on public.properties;
create trigger trg_properties_staff_enforce before update on public.properties for each row execute function public.enforce_staff_property_update();

drop trigger if exists trg_properties_updated_at on public.properties;
create trigger trg_properties_updated_at before update on public.properties for each row execute function public.set_updated_at();

drop trigger if exists trg_sync_properties_identity_key on public.properties;
create trigger trg_sync_properties_identity_key before insert or update on public.properties for each row execute function public.sync_properties_identity_key();

drop trigger if exists trg_sync_properties_identity_key_v2 on public.properties;
create trigger trg_sync_properties_identity_key_v2 before insert or update on public.properties for each row execute function public.sync_properties_identity_key_v2();

drop trigger if exists trg_property_photos_updated_at on public.property_photos;
create trigger trg_property_photos_updated_at before update on public.property_photos for each row execute function public.touch_property_photos_updated_at();
