import {supabase,AUTH_STORAGE_KEY} from './supabase';

type OperatorUpdatePreparation = { userId: string; prepare: () => Promise<void> };
let operatorUpdatePreparation: OperatorUpdatePreparation | null = null;

export function registerOperatorUpdatePreparation(userId: string, prepare: () => Promise<void>) {
 const registration = { userId, prepare };
 operatorUpdatePreparation = registration;
 return () => { if (operatorUpdatePreparation === registration) operatorUpdatePreparation = null; };
}

// Wait for the SDK's recovery/refresh lock before navigating away. Never copy
// tokens, restore revoked sessions or persist the operator PIN.
export async function prepareAppUpdate(expectedUserId:string|null=null){
 if(!supabase)return;
 let before:string|null;
 try{before=localStorage.getItem(AUTH_STORAGE_KEY);}catch{throw new Error('O navegador não permite salvar o login. Mantenha o app aberto e confira as permissões de armazenamento antes de atualizar.');}
 const {data,error}=await supabase.auth.getSession();
 if(error)throw new Error('Não foi possível confirmar seu login. Verifique a conexão e tente atualizar novamente.');
 if(!data.session){
  if(before||expectedUserId)throw new Error('Não foi possível recuperar o login salvo. Confirme seu acesso antes de atualizar.');
  return;
 }
 let stored:{user?:{id?:unknown};refresh_token?:unknown;access_token?:unknown}|null=null;
 let persistedLogin: string | null = null;
 try{persistedLogin=localStorage.getItem(AUTH_STORAGE_KEY);stored=JSON.parse(persistedLogin??'null');}catch{/* Refuse a reload with unreadable persistence. */}
 if((expectedUserId&&expectedUserId!==data.session.user.id)||stored?.user?.id!==data.session.user.id||typeof stored.refresh_token!=='string'||!stored.refresh_token||stored.access_token!==data.session.access_token){
  throw new Error('Seu login ainda não está salvo neste navegador. Tente atualizar novamente sem fechar o app.');
 }
 const preparation = operatorUpdatePreparation;
 if (preparation) {
  if (preparation.userId !== data.session.user.id) throw new Error('A conta mudou. Confirme seu acesso antes de atualizar.');
  await preparation.prepare();
  if (operatorUpdatePreparation !== preparation) throw new Error('O operador mudou. Confira o acesso antes de atualizar.');
  let latest: unknown;
  try { latest = localStorage.getItem(AUTH_STORAGE_KEY); } catch { throw new Error('Não foi possível conferir o login salvo. Tente novamente sem fechar o app.'); }
  if (latest !== persistedLogin) throw new Error('Confirme seu acesso antes de atualizar.');
 }
}
