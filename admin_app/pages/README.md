# Private admin application

This is a separate static application served at `/admin/`. It has its own administrator-only login and calls the same backend API as the customer site with a role-scoped token. It is not embedded in the customer application.
