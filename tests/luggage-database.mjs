// Offline PostgreSQL/RLS verification only; never connects to a hosted database.
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db = new PGlite();
let checks = 0;
const check = (value, expected) => { assert.deepEqual(value, expected); checks += 1; };
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;
    grant usage on schema public,auth,storage to authenticated,anon;
    alter default privileges in schema public grant all on tables to authenticated;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key,bucket_id text,name text,owner uuid,metadata jsonb);
    create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
    create publication supabase_realtime;`);
  const dir = new URL("../supabase/migrations/", import.meta.url);
  const legacyPrivateId = randomUUID(), legacySharedId = randomUUID(), legacyPackId = randomUUID();
  let legacySnapshot;
  for (const file of (await fs.readdir(dir)).filter((name) => name.endsWith(".sql") && !name.endsWith("_luggage_required_assignee.sql")).sort()) {
    if (file.endsWith("_luggage_collaboration_state_safety.sql")) {
      const historicOwner=randomUUID(), historicTrip=randomUUID();
      await db.query("insert into auth.users(id) values($1)",[historicOwner]);
      await db.query("insert into trips(id,title,name,destination,start_date,end_date,owner_id) values($1,'Historical','Historical','Japan',current_date-10,current_date-5,$2)",[historicTrip,historicOwner]);
      await db.query("insert into trip_members(trip_id,user_id,role,status) values($1,$2,'owner','approved')",[historicTrip,historicOwner]);
      await db.query("insert into shared_luggage_items(id,trip_id,title,assigned_to,packed_by_assignee,confirmed_by_owner) values($1,$2,'Historic shared',$3,true,true)",[legacySharedId,historicTrip,historicOwner]);
      await db.query("insert into luggage_items(id,trip_id,owner_id,title,packed,is_shared_assigned_item,shared_item_id) values($1,$2,$3,'Historic mirror',false,true,$4)",[legacyPrivateId,historicTrip,historicOwner,legacySharedId]);
      await db.query("insert into pack_items(id,trip_id,title,created_by,done) values($1,$2,'Historic pack',$3,true)",[legacyPackId,historicTrip,historicOwner]);
      legacySnapshot=(await db.query("select (to_jsonb(t.*) - 'notes') r from luggage_items t where id=$1 union all select (to_jsonb(t.*) - 'notes') r from shared_luggage_items t where id=$2 union all select to_jsonb(t.*) r from pack_items t where id=$3",[legacyPrivateId,legacySharedId,legacyPackId])).rows;
    }
    await db.exec((await fs.readFile(new URL(file, dir), "utf8")).replace(/create extension if not exists pgcrypto;/ig, ""));
  }
  check((await db.query("select (to_jsonb(t.*) - 'notes' - 'sort_order') r from luggage_items t where id=$1 union all select (to_jsonb(t.*) - 'notes' - 'sort_order') r from shared_luggage_items t where id=$2 union all select to_jsonb(t.*) r from pack_items t where id=$3",[legacyPrivateId,legacySharedId,legacyPackId])).rows, legacySnapshot);
  const owner = randomUUID(), editor = randomUUID(), viewer = randomUUID(), pending = randomUUID(), outsider = randomUUID();
  const trip = randomUUID(), otherTrip = randomUUID();
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  await q("insert into auth.users(id) select unnest($1::uuid[])", [[owner, editor, viewer, pending, outsider]]);
  await q("insert into trips(id,title,name,destination,start_date,end_date,owner_id) values($1,'Trip','Trip','Japan',current_date+10,current_date+15,$3),($2,'Other','Other','Japan',current_date+10,current_date+15,$4)", [trip, otherTrip, owner, outsider]);
  await q("insert into trip_members(trip_id,user_id,role,status) values($1,$2,'owner','approved'),($1,$3,'editor','approved'),($1,$4,'viewer','approved'),($1,$5,'viewer','pending'),($6,$7,'owner','approved')", [trip,owner,editor,viewer,pending,otherTrip,outsider]);
  const login = async (id, role = "authenticated") => { await db.exec(`set role ${role}`); await q("select set_config('request.jwt.claim.sub',$1,false)",[id || ""]); };
  const row = async (id, scope = "shared") => (await q(`select to_jsonb(t.*) r from ${scope === "shared" ? "shared_luggage_items" : "luggage_items"} t where id=$1`,[id]))[0]?.r;
  const mutate = async (scope, action, payload = {}, item = null, tripId = trip, base = item?.updated_at) =>
    (await q("select mutate_luggage_item($1,$2,$3,$4,$5,$6::jsonb) r",[tripId,scope,action,item?.id || null,base || null,JSON.stringify(payload)]))[0].r;
  const rejects = async (task, code) => { await assert.rejects(task, new RegExp(code)); checks += 1; };

  // Every approved member, including viewers, manages their own private list.
  await login(viewer);
  let own = await mutate("personal","save",{title:"護照",category:"證件"});
  check(own.owner_id,viewer);
  own = await mutate("personal","patch",{packed:true},own);
  check(own.packed,true);
  await rejects(()=>mutate("personal","patch",{packed:false},{...own,updated_at:"2000-01-01T00:00:00Z"}),"luggage_stale");
  own = await mutate("personal","save",{title:"護照正本",category:"證件"},own);
  check(own.packed,true);
  own = await mutate("personal","save",{title:own.title,category:"證件",notes:"私人備註"},own);
  check(own.notes,"私人備註");
  own = await mutate("personal","save",{title:own.title,category:"電子用品"},own);
  check([own.notes,own.category,own.packed],["私人備註","電子用品",true]);
  await rejects(()=>mutate("personal","save",{title:own.title,notes:"x".repeat(1001)},own),"luggage_invalid_payload");
  await rejects(()=>mutate("personal","save",{title:own.title,notes:42},own),"luggage_invalid_payload");
  // Even trip owner cannot query or mutate someone else's personal items.
  await login(owner); check(await row(own.id,"personal"),undefined);
  await rejects(()=>mutate("personal","delete",{},own),"luggage_not_found");
  await rejects(()=>q("insert into luggage_items(trip_id,owner_id,title) values($1,$2,'Spy')",[trip,viewer]),"luggage_invalid_payload|row-level security");
  await login(viewer);
  await rejects(()=>q("update luggage_items set trip_id=$1 where id=$2",[otherTrip,own.id]),"luggage_invalid_payload");
  await rejects(()=>q("update luggage_items set owner_id=$1 where id=$2",[owner,own.id]),"luggage_invalid_payload");

  // Shared creation/content management by approved viewer is intentional.
  let shared = await mutate("shared","save",{title:"延長線",category:"電子用品",assigned_to:editor});
  check([shared.packed_by_assignee,shared.confirmed_by_owner],[false,false]);
  await rejects(()=>mutate("shared","patch",{packed_by_assignee:true},shared),"luggage_forbidden");
  await rejects(()=>mutate("shared","patch",{confirmed_by_owner:true},shared),"luggage_forbidden");
  await login(owner);
  await rejects(()=>mutate("shared","patch",{confirmed_by_owner:true},shared),"luggage_not_packed");
  await rejects(()=>mutate("shared","patch",{packed_by_assignee:true},shared),"luggage_forbidden");
  await login(editor);
  shared = await mutate("shared","patch",{packed_by_assignee:true},shared);
  check([shared.packed_by_assignee,shared.confirmed_by_owner],[true,false]);
  await rejects(()=>mutate("shared","patch",{confirmed_by_owner:true},shared),"luggage_forbidden");
  await login(owner);
  shared = await mutate("shared","patch",{confirmed_by_owner:true},shared);
  check([shared.packed_by_assignee,shared.confirmed_by_owner],[true,true]);
  await login(viewer);
  await rejects(()=>mutate("shared","patch",{confirmed_by_owner:false},shared),"luggage_forbidden");
  await login(editor);
  shared = await mutate("shared","patch",{packed_by_assignee:false},shared);
  check([shared.packed_by_assignee,shared.confirmed_by_owner],[false,false]);

  const packAndConfirm = async () => { await login(shared.assigned_to); shared=await mutate("shared","patch",{packed_by_assignee:true},shared); await login(owner); shared=await mutate("shared","patch",{confirmed_by_owner:true},shared); };
  await packAndConfirm();
  await login(viewer);
  shared=await mutate("shared","save",{title:"延長線 2m",category:"電子用品",assigned_to:editor},shared);
  check([shared.packed_by_assignee,shared.confirmed_by_owner],[false,false]);
  await packAndConfirm();
  shared=await mutate("shared","save",{title:shared.title,category:"共用裝備",assigned_to:editor},shared);
  check([shared.packed_by_assignee,shared.confirmed_by_owner],[false,false]);
  await packAndConfirm();
  const staleBeforeReassign=shared;
  shared=await mutate("shared","save",{title:shared.title,category:shared.category,assigned_to:viewer},shared);
  check([shared.assigned_to,shared.packed_by_assignee,shared.confirmed_by_owner],[viewer,false,false]);
  await login(editor);
  await rejects(()=>mutate("shared","patch",{packed_by_assignee:true},staleBeforeReassign),"luggage_stale");
  await rejects(()=>mutate("shared","patch",{packed_by_assignee:true},shared),"luggage_forbidden");
  await login(viewer);
  shared=await mutate("shared","patch",{packed_by_assignee:true},shared);
  await login(owner); shared=await mutate("shared","patch",{confirmed_by_owner:true},shared);
  shared=await mutate("shared","save",{title:shared.title,category:shared.category,assigned_to:null},shared);
  check([shared.assigned_to,shared.packed_by_assignee,shared.confirmed_by_owner],[null,false,false]);
  await rejects(()=>mutate("shared","save",{title:shared.title,assigned_to:pending},shared),"luggage_invalid_assignee");
  await rejects(()=>mutate("shared","save",{title:shared.title,assigned_to:outsider},shared),"luggage_invalid_assignee");
  await rejects(()=>mutate("shared","patch",{packed_by_assignee:true,confirmed_by_owner:true},shared),"luggage_invalid_payload");
  await rejects(()=>mutate("shared","patch",{confirmed_by_owner:"true"},shared),"luggage_invalid_payload");
  await rejects(()=>mutate("shared","save",{title:" ",assigned_to:null},shared),"luggage_invalid_payload");

  // Direct table clients cannot forge confirmations or cross-trip identities.
  await rejects(()=>q("update shared_luggage_items set confirmed_by_owner=true where id=$1",[shared.id]),"luggage_not_packed");
  await rejects(()=>q("update shared_luggage_items set trip_id=$1 where id=$2",[otherTrip,shared.id]),"luggage_invalid_payload");
  await login(viewer);
  await rejects(()=>q("update shared_luggage_items set packed_by_assignee=true where id=$1",[shared.id]),"luggage_forbidden");
  let fresh=await mutate("shared","save",{title:"藥包",assigned_to:viewer});
  // An old client tries creating an already confirmed item: both states normalize safely.
  let inserted=(await q("insert into shared_luggage_items(trip_id,title,assigned_to,packed_by_assignee,confirmed_by_owner) values($1,'Old client',$2,true,true) returning to_jsonb(shared_luggage_items.*) r",[trip,viewer]))[0].r;
  check([inserted.packed_by_assignee,inserted.confirmed_by_owner],[false,false]);

  // Live edit locks protect content, ticks and deletes; expiry allows recovery.
  await q("update shared_luggage_items set locked_by=$1,locked_at=clock_timestamp() where id=$2",[viewer,fresh.id]);
  fresh=await row(fresh.id); await login(owner);
  await rejects(()=>mutate("shared","delete",{},fresh),"luggage_locked");
  await rejects(()=>mutate("shared","save",{title:"Interference",assigned_to:viewer},fresh),"luggage_locked");
  await rejects(()=>q("update shared_luggage_items set locked_by=$1,locked_at=clock_timestamp() where id=$2",[owner,fresh.id]),"luggage_locked");
  await login(viewer); await q("update shared_luggage_items set locked_by=null,locked_at=null where id=$1",[fresh.id]);
  const firstBase=await row(fresh.id);
  fresh=await mutate("shared","save",{title:"Concurrent A",assigned_to:viewer},firstBase);
  await login(owner);
  await rejects(()=>mutate("shared","save",{title:"Concurrent B",assigned_to:viewer},firstBase),"luggage_stale");
  check((await row(fresh.id)).title,"Concurrent A");
  await rejects(()=>mutate("shared","delete",{},fresh,otherTrip),"luggage_forbidden");

  // Membership revocation preserves history but prevents advancing an obsolete assignment.
  let revoked=await mutate("shared","save",{title:"Former assignee",assigned_to:editor});
  await login(editor); revoked=await mutate("shared","patch",{packed_by_assignee:true},revoked);
  await login(owner);
  await q("update trip_members set status='pending' where trip_id=$1 and user_id=$2",[trip,editor]);
  await rejects(()=>mutate("shared","patch",{confirmed_by_owner:true},revoked),"luggage_invalid_assignee");
  check([(await row(revoked.id)).packed_by_assignee,(await row(revoked.id)).confirmed_by_owner],[true,false]);
  await login(editor);
  await rejects(()=>mutate("shared","patch",{packed_by_assignee:false},revoked),"luggage_forbidden");
  await login(owner);
  revoked=await mutate("shared","save",{title:revoked.title,assigned_to:viewer},revoked);
  check([revoked.assigned_to,revoked.packed_by_assignee,revoked.confirmed_by_owner],[viewer,false,false]);
  await q("update trip_members set status='approved' where trip_id=$1 and user_id=$2",[trip,editor]);

  // Pending, outsider and anonymous cannot access team/private data or RPCs.
  for (const actor of [pending,outsider]) {
    await login(actor); check(await row(shared.id),undefined); check(await row(own.id,"personal"),undefined);
    await rejects(()=>mutate("shared","save",{title:"Blocked"}),"luggage_forbidden");
    await rejects(()=>mutate("personal","save",{title:"Blocked"}),"luggage_forbidden");
    await rejects(()=>q("insert into shared_luggage_items(trip_id,title) values($1,'Direct blocked')",[trip]),"luggage_forbidden|row-level security");
    check((await q("update shared_luggage_items set title='No access' where id=$1 returning id",[shared.id])).length,0);
  }
  await login(null,"anon");
  await rejects(()=>mutate("shared","save",{title:"Anon"}),"permission denied");
  await rejects(()=>q("select * from luggage_items"),"permission denied");
  await rejects(()=>q("select * from shared_luggage_items"),"permission denied");

  // Existing legacy pack_items remains independent and unmodified.
  await login(owner);
  await q("insert into pack_items(trip_id,title,created_by,done) values($1,'Legacy camera',$2,true)",[trip,owner]);
  const legacy=(await q("select to_jsonb(t.*) r from pack_items t where trip_id=$1",[trip]))[0].r;
  await login(viewer); await mutate("shared","delete",{},await row(fresh.id));
  check((await q("select to_jsonb(t.*) r from pack_items t where trip_id=$1",[trip]))[0].r,legacy);
  await mutate("personal","delete",{},await row(own.id,"personal")); check(await row(own.id,"personal"),undefined);

  // Security metadata: no definer RPC/new exposed tables, existing RLS+Realtime preserved.
  await db.exec("reset role");
  check((await q("select prosecdef from pg_proc where proname='mutate_luggage_item'"))[0].prosecdef,false);
  check((await q("select count(*)::int n from pg_class where relname in ('luggage_items','shared_luggage_items') and relrowsecurity and relreplident='f'"))[0].n,2);
  check((await q("select count(*)::int n from pg_publication_tables where pubname='supabase_realtime' and tablename in ('luggage_items','shared_luggage_items')"))[0].n,2);
  await login(editor);
  let noteGear = await mutate("shared","save",{title:"備註測試",assigned_to:editor,notes:"公開備註"});
  noteGear = await mutate("shared","patch",{packed_by_assignee:true},noteGear);
  await login(viewer);
  noteGear = await mutate("shared","save",{title:noteGear.title,assigned_to:editor,notes:"更新說明"},noteGear);
  check([noteGear.notes,noteGear.packed_by_assignee],["更新說明",true]);
  await login(pending); await rejects(()=>mutate("shared","save",{title:noteGear.title,notes:"不應寫入"},noteGear),"luggage_forbidden");
  await login(outsider); check(await row(noteGear.id),undefined);
  // Conversion is one invoker transaction: private source is never duplicated,
  // leaked to another owner or deleted after a rejected assignment.
  const assign = async (scope, item, assignee, targetTrip = trip, base = item.updated_at) =>
    (await q("select assign_luggage_item($1,$2,$3,$4,$5) r",[targetTrip,scope,item.id,base,assignee]))[0].r;
  await login(viewer);
  let source = await mutate("personal","save",{title:"分享用轉接頭",category:"電子用品",notes:"全體可見備註"});
  source = await mutate("personal","patch",{packed:true},source);
  await rejects(()=>assign("personal",source,pending),"luggage_invalid_assignee");
  check((await row(source.id,"personal")).title,source.title); check(await row(source.id),undefined);
  await rejects(()=>assign("personal",source,owner,trip,"2000-01-01T00:00:00Z"),"luggage_stale");
  await login(owner); await rejects(()=>assign("personal",source,owner),"luggage_not_found");
  await login(viewer);
  const converted = await assign("personal",source,owner);
  check([converted.id,converted.title,converted.category,converted.notes,converted.assigned_to,converted.packed_by_assignee],[source.id,source.title,source.category,source.notes,owner,false]);
  check(await row(source.id,"personal"),undefined);
  await rejects(()=>assign("personal",source,owner),"luggage_not_found");
  check((await q("select count(*)::int n from shared_luggage_items where id=$1",[source.id]))[0].n,1);
  const same = await assign("shared",converted,owner); check(same.updated_at,converted.updated_at);
  await login(owner); let packedConverted = await mutate("shared","patch",{packed_by_assignee:true},converted);
  await login(viewer); packedConverted = await assign("shared",packedConverted,null);
  check([packedConverted.assigned_to,packedConverted.packed_by_assignee,packedConverted.notes],[null,false,source.notes]);
  await rejects(()=>assign("shared",converted,viewer),"luggage_stale");
  await login(pending); await rejects(()=>assign("shared",packedConverted,viewer),"luggage_forbidden");
  await login(outsider); await rejects(()=>assign("shared",packedConverted,viewer),"luggage_forbidden");
  await login(viewer);
  let collision = await mutate("personal","save",{title:"碰撞時保留原項目",notes:"不能遺失"});
  await q("insert into shared_luggage_items(id,trip_id,title) values($1,$2,'Existing id')",[collision.id,trip]);
  await rejects(()=>assign("personal",collision,viewer),"duplicate key");
  check((await row(collision.id,"personal")).notes,"不能遺失");
  const blocked = await mutate("personal","save",{title:"交易回滾保護"});
  await db.exec("reset role");
  await db.exec("create function public.test_reject_conversion_delete() returns trigger language plpgsql as $$ begin raise exception 'test_delete_blocked'; end $$; create trigger test_reject_conversion_delete before delete on public.luggage_items for each row execute function public.test_reject_conversion_delete();");
  await login(viewer); await rejects(()=>assign("personal",blocked,viewer),"test_delete_blocked");
  check(await row(blocked.id),undefined); check((await row(blocked.id,"personal")).title,blocked.title);
  await db.exec("reset role; drop trigger test_reject_conversion_delete on public.luggage_items; drop function public.test_reject_conversion_delete();");
  check((await q("select prosecdef from pg_proc where proname='assign_luggage_item'"))[0].prosecdef,false);
  await login("","anon"); await rejects(()=>assign("personal",blocked,viewer),"permission denied");
  const privatize = async (item, category = "", targetTrip = trip, base = item.updated_at) =>
    (await q("select privatize_luggage_item($1,$2,$3,$4) r",[targetTrip,item.id,base,category]))[0].r;
  await login(viewer);
  let publicSource = await mutate("shared","save",{title:"轉回私人物品",notes:"收納說明",assigned_to:owner});
  await login(owner); publicSource = await mutate("shared","patch",{packed_by_assignee:true},publicSource);
  await login(viewer);
  await rejects(()=>privatize(publicSource,"衣物",otherTrip),"luggage_forbidden");
  await rejects(()=>privatize(publicSource,"衣物",trip,"2000-01-01T00:00:00Z"),"luggage_stale");
  check((await row(publicSource.id)).packed_by_assignee,true);
  await login(pending); await rejects(()=>privatize(publicSource,"衣物"),"luggage_forbidden");
  await login(outsider); await rejects(()=>privatize(publicSource,"衣物"),"luggage_forbidden");
  await login(viewer); const returned = await privatize(publicSource," 衣物 ");
  check([returned.id,returned.owner_id,returned.title,returned.notes,returned.category,returned.packed,returned.shared_item_id,returned.is_shared_assigned_item],
    [publicSource.id,viewer,publicSource.title,publicSource.notes,"衣物",false,null,false]);
  check(await row(publicSource.id),undefined);
  await rejects(()=>privatize(publicSource,"衣物"),"luggage_not_found");
  check((await q("select count(*)::int n from luggage_items where id=$1",[returned.id]))[0].n,1);
  await login(owner); check(await row(returned.id,"personal"),undefined);
  await login(viewer);
  const roundTrip = await assign("personal",returned,owner);
  check([roundTrip.notes,roundTrip.assigned_to,roundTrip.packed_by_assignee],[returned.notes,owner,false]);
  check(await row(returned.id,"personal"),undefined);
  const locked = await mutate("shared","save",{title:"鎖定中的公物",assigned_to:viewer});
  await q("update shared_luggage_items set locked_by=$1,locked_at=clock_timestamp() where id=$2",[viewer,locked.id]);
  const lockedBase=await row(locked.id); await login(owner);
  await rejects(()=>privatize(lockedBase,"電子用品"),"luggage_locked"); check(await row(locked.id,"personal"),undefined);
  await login(viewer); await rejects(async ()=>privatize(await row(collision.id),"電子用品"),"duplicate key");
  check((await row(collision.id)).title,"Existing id");
  const returnBlocked = await mutate("shared","save",{title:"回私物交易回滾",notes:"保留公物"});
  await db.exec("reset role; create function public.test_reject_return_delete() returns trigger language plpgsql as $$ begin raise exception 'test_return_delete_blocked'; end $$; create trigger test_reject_return_delete before delete on public.shared_luggage_items for each row execute function public.test_reject_return_delete();");
  await login(viewer); await rejects(()=>privatize(returnBlocked,"衣物"),"test_return_delete_blocked");
  check(await row(returnBlocked.id,"personal"),undefined); check((await row(returnBlocked.id)).notes,"保留公物");
  await db.exec("reset role; drop trigger test_reject_return_delete on public.shared_luggage_items; drop function public.test_reject_return_delete();");
  check((await q("select prosecdef from pg_proc where proname='privatize_luggage_item'"))[0].prosecdef,false);
  await login("","anon"); await rejects(()=>privatize(returnBlocked,"衣物"),"permission denied");
  // Ordering is authoritative and atomic, with full-list versions including hidden rows.
  await db.exec("reset role");
  const orderTrip = randomUUID();
  await q("insert into trips(id,title,name,destination,start_date,end_date,owner_id) values($1,'Order','Order','Japan',current_date+10,current_date+15,$2)",[orderTrip,owner]);
  await q("insert into trip_members(trip_id,user_id,role,status) values($1,$2,'owner','approved'),($1,$3,'viewer','approved'),($1,$4,'viewer','pending')",[orderTrip,owner,viewer,pending]);
  await login(viewer);
  let a=await mutate('personal','save',{title:'A',category:'證件',notes:'keep'},null,orderTrip);
  let b=await mutate('personal','save',{title:'B',category:'衣物'},null,orderTrip);
  let c=await mutate('personal','save',{title:'C',category:'衣物'},null,orderTrip);
  a=await mutate('personal','patch',{packed:true},a,orderTrip);
  // PGlite parses timestamptz columns as JS Date (milliseconds). Return JSON text
  // to retain PostgreSQL's microseconds, as PostgREST does for exact version checks.
  const manifest=async scope => (await q(`select to_jsonb(t) r from (select id,updated_at from ${scope==='personal'?'luggage_items':'shared_luggage_items'} where trip_id=$1 order by sort_order nulls last,created_at,id) t`,[orderTrip])).map(row=>row.r);
  const reorder=async (scope,source,target,placement='before',expected=null) => (await q('select reorder_luggage_items($1,$2,$3,$4,$5,$6::jsonb) r',[orderTrip,scope,source.id,target.id,placement,JSON.stringify(expected || await manifest(scope))]))[0].r;
  const staleOrder=await manifest('personal');
  let ordered=await reorder('personal',a,c);
  check(ordered.map(r=>r.id),[b.id,a.id,c.id]);
  a=ordered.find(r=>r.id===a.id); b=ordered.find(r=>r.id===b.id); c=ordered.find(r=>r.id===c.id);
  check([a.category,a.notes,a.packed],['衣物','keep',true]);
  await rejects(()=>reorder('personal',a,b,'before',staleOrder),'luggage_stale');
  await rejects(()=>reorder('personal',a,b,'before',[...staleOrder.slice(0,2),staleOrder[0]]),'luggage_stale');
  const sameOrder=await manifest('personal'); await reorder('personal',a,c);
  check(await manifest('personal'),sameOrder);
  ordered=await reorder('personal',b,c,'after'); check(ordered.map(r=>r.id),[a.id,c.id,b.id]);
  await login(owner); await rejects(async ()=>reorder('personal',a,b,'before',await manifest('personal')),'luggage_not_found');
  check((await manifest('personal')).length,0);
  await login(viewer);
  let s1=await mutate('shared','save',{title:'S1',assigned_to:viewer},null,orderTrip);
  let s2=await mutate('shared','save',{title:'S2',assigned_to:viewer},null,orderTrip);
  let s3=await mutate('shared','save',{title:'S3',assigned_to:owner},null,orderTrip);
  s1=await mutate('shared','patch',{packed_by_assignee:true},s1,orderTrip);
  ordered=await reorder('shared',s1,s2,'after'); check(ordered.findIndex(r=>r.id===s1.id),ordered.findIndex(r=>r.id===s2.id)+1);
  check(ordered.find(r=>r.id===s1.id).packed_by_assignee,true);
  ordered=await reorder('shared',s1,s3); check(ordered.find(r=>r.id===s1.id).assigned_to,owner);
  check(ordered.find(r=>r.id===s1.id).packed_by_assignee,false);
  const beforeLock=await manifest('shared');
  await login(owner); await q('update shared_luggage_items set locked_by=$1,locked_at=clock_timestamp() where id=$2',[owner,s3.id]);
  await login(viewer); const lockedOrder=await manifest('shared');
  await rejects(()=>reorder('shared',s1,s2,'before',beforeLock),'luggage_stale');
  await rejects(()=>reorder('shared',s1,s2,'before',lockedOrder),'luggage_locked');
  check(await manifest('shared'),lockedOrder);
  await login(pending); await rejects(()=>reorder('shared',s1,s2,'before',lockedOrder),'luggage_forbidden');
  await login(outsider); await rejects(()=>reorder('shared',s1,s2,'before',lockedOrder),'luggage_forbidden');
  await login('','anon'); await rejects(()=>reorder('shared',s1,s2,'before',lockedOrder),'permission denied');
  await db.exec('reset role'); check((await q("select prosecdef from pg_proc where proname='reorder_luggage_items'"))[0].prosecdef,false);
  // Phase 2: exercise all historic compatibility first, then the new
  // irreversible cleanup in one offline transaction with exact snapshots.
  await db.exec('reset role');
  await q("select set_config('request.jwt.claim.sub','',false)");
  const beforeCleanup = await q("select id from shared_luggage_items where assigned_to is null order by id");
  const assignedBefore = await q("select to_jsonb(t) r from shared_luggage_items t where assigned_to is not null order by id");
  const privateBefore = await q("select to_jsonb(t) r from luggage_items t order by id");
  await db.exec('begin');
  await db.exec(await fs.readFile(new URL('20261026120000_luggage_required_assignee.sql',dir),'utf8'));
  await db.exec('commit');
  check((await q("select count(*)::int n from shared_luggage_items where assigned_to is null"))[0].n,0);
  check(await q("select to_jsonb(t) r from shared_luggage_items t order by id"),assignedBefore);
  check(await q("select to_jsonb(t) r from luggage_items t order by id"),privateBefore);
  await login(viewer);
  await rejects(()=>mutate('shared','save',{title:'No carrier'}),'luggage_invalid_assignee');
  await rejects(()=>q("insert into shared_luggage_items(trip_id,title,assigned_to) values($1,'No carrier',null)",[trip]),'luggage_invalid_assignee');
  let required=await mutate('shared','save',{title:'Required carrier',assigned_to:editor});
  await rejects(()=>mutate('shared','save',{title:required.title,assigned_to:null},required),'luggage_invalid_assignee');
  await rejects(()=>assign('shared',required,null),'luggage_invalid_assignee');
  await rejects(()=>q("update shared_luggage_items set assigned_to=null where id=$1",[required.id]),'luggage_invalid_assignee');
  await rejects(()=>q("update shared_luggage_items set assigned_to=$1 where id=$2",[pending,required.id]),'luggage_invalid_assignee');
  await rejects(()=>mutate('shared','patch',{packed_by_assignee:true},required),'luggage_forbidden');
  // Existing legacy owner-confirmation fields remain server-compatible, while
  // readiness is still exclusively controlled by the assignee.
  await login(owner);
  await rejects(()=>mutate('shared','patch',{packed_by_assignee:true},required),'luggage_forbidden');
  await db.exec('reset role');
  const member=(await q("select id from trip_members where trip_id=$1 and user_id=$2",[trip,editor]))[0];
  await rejects(()=>q("delete from trip_members where id=$1",[member.id]),'luggage_assignee_membership_fk');
  await rejects(()=>q("update trip_members set status='pending' where id=$1",[member.id]),'luggage_reassign_required');
  await rejects(()=>q("delete from auth.users where id=$1",[editor]),'luggage_assignee');
  check((await q("select assigned_to from shared_luggage_items where id=$1",[required.id]))[0].assigned_to,editor);
  // A whole-trip delete remains legal: both member and assigned item disappear
  // within the same statement, rather than blocking parent cascade cleanup.
  const deleteTrip=randomUUID();
  await q("insert into trips(id,title,name,destination,start_date,end_date,owner_id) values($1,'Delete','Delete','Japan',current_date,current_date+1,$2)",[deleteTrip,owner]);
  await q("insert into trip_members(trip_id,user_id,role,status) values($1,$2,'owner','approved'),($1,$3,'viewer','approved')",[deleteTrip,owner,viewer]);
  await login(owner);let movable=await mutate('shared','save',{title:'Whole trip',assigned_to:viewer},null,deleteTrip);
  movable=await assign('shared',movable,owner,deleteTrip);
  await db.exec('reset role');
  await q('delete from trip_members where trip_id=$1 and user_id=$2',[deleteTrip,viewer]);
  check((await q('select count(*)::int n from trip_members where trip_id=$1 and user_id=$2',[deleteTrip,viewer]))[0].n,0);
  await q('delete from trips where id=$1',[deleteTrip]);
  check((await q('select count(*)::int n from shared_luggage_items where trip_id=$1',[deleteTrip]))[0].n,0);
  check((await q("select has_function_privilege('authenticated','app_private.require_luggage_assignee()','EXECUTE') allowed"))[0].allowed,false);
  check((await q("select has_function_privilege('anon','app_private.require_luggage_assignee()','EXECUTE') allowed"))[0].allowed,false);
  check((await q("select bool_and(relrowsecurity) enabled from pg_class where oid in ('public.luggage_items'::regclass,'public.shared_luggage_items'::regclass)"))[0].enabled,true);
  console.log(`Required-assignee offline cleanup: ${beforeCleanup.length} null-assignee rows removed; assigned/private snapshots unchanged.`);
  console.log(`Luggage offline PostgreSQL: ${checks} assertions passed (full migration chain, RLS, ordering, stale manifests, private isolation, conversion rollback, locks, legacy compatibility).`);
} finally { await db.close(); }
