# Cookie's Restaurant and Coffee Shop — Remade Ordering System

This version keeps the menu data from the uploaded HTML and adds:
- A photo on EVERY menu item (replace `/public/images/placeholder.svg` or upload images from Admin).
- Working cart with quantity controls and total.
- Customer checkout/order form.
- Orders saved in SQLite.
- Admin login and protected admin dashboard.
- Admin can add/edit/delete categories and menu items, change prices/descriptions, toggle availability, and upload item photos.
- Sticky, highly visible left-top back button on category pages.
- More frequent/smoother hamburger animation.
- Security basics: Helmet, rate limiting, HttpOnly session cookie, bcrypt password hash, parameterized SQLite queries.
- Optional Messenger delivery through Meta Graph API. This requires a Facebook Page access token and is intentionally server-side; do NOT put the token in frontend JavaScript.

## Run locally

1. Install Node.js 20+.
2. Open this folder in a terminal.
3. Run:
   npm install
4. Copy `.env.example` to `.env`.
5. Create a bcrypt password hash:
   node -e "console.log(require('bcryptjs').hashSync('YourStrongPassword', 12))"
6. Put the generated hash into `ADMIN_PASSWORD_HASH`.
7. Start:
   npm start
8. Open:
   http://localhost:3000
9. Admin:
   http://localhost:3000/admin.html

## Important for real deployment

A static HTML file cannot securely run an admin system or send orders to Messenger by itself. This project therefore uses:
Frontend: HTML/CSS/JavaScript
Backend: Node.js + Express
Database: SQLite
Security: Helmet + rate limiting + bcrypt + secure session settings
Uploads: Multer
Messenger: server-side Meta Graph API integration

For production, use HTTPS, a strong SESSION_SECRET, a strong unique admin password, regular database backups, and a proper production session store (not the default in-memory Express session store).

## Messenger

Orders are always saved locally first. If Messenger variables are configured, the server also attempts to send a formatted order notification to the configured Facebook Page through Meta's API. The exact Meta permissions/token setup depends on the Page and current Meta requirements.

If Messenger is not configured, the order still appears immediately in Admin > Orders.
