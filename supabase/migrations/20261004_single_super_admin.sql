UPDATE public.users
SET admin_role = CASE
  WHEN lower(trim(email)) = 'cetnova26@gmail.com' THEN 'Super Admin'
  ELSE 'ADMIN'
END
WHERE role = 'admin';
