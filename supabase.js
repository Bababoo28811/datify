// supabase.js — shared Supabase client
// Referenced by: supplier-dashboard.html
// Must be loaded AFTER the Supabase CDN script tag.

const SUPABASE_URL  = 'https://uujbonptqglzndzlovmp.supabase.co';
const SUPABASE_ANON = 'sb_publishable_247UBPSKcL_D73j01iuECw_J2ZKj8fn';

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
