# PAPERPLAZO Firebase integration notes

This project keeps the original static HTML/CSS/JS storefront and admin dashboard in place and adds a Firebase-ready integration layer without changing the visible design.

## Required Firebase setup

1. Open the Firebase Console for the project named `paperplazo`.
2. Go to Project settings > General > Your apps.
3. Register or select the web app and copy the web config values.
4. Paste those values into `.env.example` and then copy it to `.env` for local development.
5. Enable Email/Password Authentication in Firebase Authentication.
6. Create Firestore in Native mode.
7. Deploy the rules from `firestore.rules`.

## Local development notes

- The app is served from the Flask backend at `http://127.0.0.1:5000`.
- Firebase modules are loaded as browser modules from the `/shared` folder and are intentionally safe when config is not yet filled in.
- The app will not connect to Firebase until the real Firebase web config is inserted.

## Production note

This project uses Firebase client-side configuration values in the browser. The backend should continue to validate prices and order totals before accepting a checkout request.

## Security note

Firebase custom claims are the recommended way to mark an admin user. Customers should never be allowed to assign themselves the `admin` role.
