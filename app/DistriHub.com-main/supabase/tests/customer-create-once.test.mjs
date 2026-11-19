import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const read=file=>readFile(new URL(file,import.meta.url),'utf8');
test('customer creation commits one receipt, replays the same UUID and enforces actor, branch, payload and access',async()=>{
 const db=new PGlite();const [owner,other,branch,foreign,request]=Array.from({length:5},()=>randomUUID());
 try{
  await db.exec(await read('./fixtures/pdv_schema.sql'));await db.exec(await read('./fixtures/pdv_production.sql'));
  await db.exec(`ALTER TABLE partner_branches ADD COLUMN is_active boolean DEFAULT true;
   ALTER TABLE partner_customers ADD COLUMN name text,ADD COLUMN document text,ADD COLUMN person_type text,ADD COLUMN phone text,ADD COLUMN email text,ADD COLUMN birthday date,ADD COLUMN address text,ADD COLUMN neighborhood text,ADD COLUMN city text,ADD COLUMN device_model text,ADD COLUMN notes text;
   CREATE SCHEMA partner_subscription_private;
   CREATE FUNCTION partner_subscription_private.require_actor(text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF current_setting('test.denied',true)='yes' THEN RAISE EXCEPTION 'Acesso revogado';END IF; END$$;
   CREATE SCHEMA partner_operations_private;
   CREATE TABLE partner_operations_private.operation_requests(actor_id uuid,kind text,request_id uuid,payload jsonb,result jsonb,created_at timestamptz DEFAULT now(),PRIMARY KEY(actor_id,kind,request_id));
   ALTER TABLE partner_operations_private.operation_requests ENABLE ROW LEVEL SECURITY;
   REVOKE ALL ON partner_operations_private.operation_requests FROM PUBLIC,anon,authenticated;`);
  const legacy=await read('../migrations/20261009192448_fix_shared_customer_credit_updates.sql');await db.exec(legacy.slice(legacy.indexOf('CREATE OR REPLACE FUNCTION public.execute_partner_customer_mutation')));
  await db.exec(await read('../migrations/20261119212330_customer_create_once.sql'));
  await db.query("INSERT INTO partner_profiles VALUES($1,'Owner','Test'),($2,'Other','Test')",[owner,other]);
  await db.query('INSERT INTO partner_branches(id,user_id) VALUES($1,$3),($2,$4)',[branch,foreign,owner,other]);
  await db.query("SELECT set_config('test.auth_uid',$1,false)",[owner]);
  const payload={branch_id:branch,name:'Cliente sem documento',phone:'92999990000',customer_type:'varejo',credit_limit:0,allow_credit:false};
  const save=async(id=request,data=payload)=>(await db.query('SELECT create_partner_customer_once($1,$2::jsonb,NULL,NULL) AS id',[id,JSON.stringify(data)])).rows[0].id;
  const first=await save();assert.match(first,/^[0-9a-f-]{36}$/);assert.equal(await save(),first);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM partner_customers')).rows[0].n,1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM partner_operations_private.operation_requests')).rows[0].n,1);
  await assert.rejects(save(request,{...payload,name:'Outro cliente'}),/tentativa/);
  await assert.rejects(save(randomUUID(),{...payload,branch_id:foreign}),/Filial|filial|Acesso/);
  await db.query("SELECT set_config('test.denied','yes',false)");await assert.rejects(save(),/revogado/);await db.query("SELECT set_config('test.denied','no',false)");
  const invalid=randomUUID();await assert.rejects(save(invalid,{...payload,birthday:'data inválida'}));
  assert.equal((await db.query('SELECT count(*)::int AS n FROM partner_operations_private.operation_requests WHERE request_id=$1',[invalid])).rows[0].n,0);
  const after=await save(invalid,{...payload,name:'Tentativa corrigida'});assert.notEqual(after,first);
  await db.query("SELECT set_config('test.auth_uid',$1,false)",[other]);await assert.rejects(save(),/Filial|filial|Acesso/);
  await db.exec('SET ROLE anon');await assert.rejects(save(),/permission denied/);await db.exec('RESET ROLE');
 }finally{await db.close();}
});
