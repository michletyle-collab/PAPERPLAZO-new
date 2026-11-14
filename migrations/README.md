# Migrations

The development database is created automatically from the SQLAlchemy model metadata. Before production deployment, initialise Alembic (or the organisation's chosen migration runner) in this directory and apply migrations as part of the deployment pipeline. Do not rely on automatic `create_all` for schema changes in production.
