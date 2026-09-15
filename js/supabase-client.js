// supabase-client.js — shared Supabase client
// Loaded before any other script on every page.

const SUPABASE_URL  = 'https://uujbonptqglzndzlovmp.supabase.co';
const SUPABASE_ANON = 'sb_publishable_247UBPSKcL_D73j01iuECw_J2ZKj8fn';

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
