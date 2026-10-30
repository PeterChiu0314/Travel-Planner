import {createClient} from '@supabase/supabase-js';
// A short-lived Storage client, using only the current user's JWT and the
// public anon key. Never mutate shared headers or share tab capabilities.
export async function receiptStorage(supabase,headers){
 const session=(await supabase.auth.getSession()).data?.session;if(!session)throw new Error('請重新登入後確認收據操作。');
 return createClient(import.meta.env.VITE_SUPABASE_URL,import.meta.env.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:`Bearer ${session.access_token}`,...headers}}}).storage.from('trip-attachments');
}
