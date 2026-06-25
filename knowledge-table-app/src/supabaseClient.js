// src/supabaseClient.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://lstcaoueyfuqfvtzwyjw.supabase.co';
const supabaseAnonKey = 'sb_publishable_-bru-hSI2I3aSxj3ObFWUg__dur24FT';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);