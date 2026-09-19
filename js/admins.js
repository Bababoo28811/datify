// admins.js — the one list of founder accounts.
//
// This email used to be written out by hand in app.js, admin.js and
// supplier.js, and in eleven RLS policies in Postgres. Adding a second
// founder address meant touching fourteen places, so both sides now have a
// single source of truth: this file for the browser, and the is_admin()
// function in Postgres for the database.
//
// Keep the two in step. They are checked independently — the list here only
// decides what the interface offers (whether the Admin link shows, whether
// the supplier whitelist is bypassed). Real enforcement is is_admin() in the
// RLS policies, and that is the one an attacker would have to beat.
//
// Loaded before app.js / admin.js / supplier.js on every page that needs it.

const ADMIN_EMAILS = [
  'elisazhu.ys@gmail.com',   // Elisa's personal account — the original founder login
  'getdatify@gmail.com'      // the Datify business inbox
];

// Case-insensitive: Supabase lowercases the email on the token, but an email
// typed into a form does not arrive lowercased, and this function is given
// both.
function isAdminEmail(email) {
  return !!email && ADMIN_EMAILS.includes(String(email).trim().toLowerCase());
}
