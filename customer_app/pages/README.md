# Customer application routes

The customer site is intentionally a small client-side application so page state, the persistent cart, and account authentication work consistently when served as static files. Its real routes are hash-based: `#home`, `#shop`, `#product/<slug>`, `#cart`, `#checkout`, `#about`, `#contact`, `#track`, `#login`, `#register`, `#account`, and `#custom`.

It is served independently at `/` (or deploy the `customer_app` folder to its own origin) and talks only to the shared `/api` backend.
