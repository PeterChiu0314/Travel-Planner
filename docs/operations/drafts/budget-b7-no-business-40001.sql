-- SUPERSEDED historical draft: classified/sealed executable candidate is in
-- ../budget-b7-staging/. See ../../2026-10-31-budget-b7-forward-package-validation.md.
-- Do NOT run this obsolete draft; its unconditional stop remains intentional.
-- REVIEW DRAFT ONLY. Outside supabase/migrations; NEVER execute in this round.
-- Proposed new terminal forward migration, AFTER all 13 B-1..B-7 sources.
-- Historical files and 20261031003000 remain immutable and are not replayed.
-- 38 direct final definitions / 78 explicitly reviewed business RAISE sites.
-- Static hashes are candidates, not a compiled catalog seal. The dynamic
-- B-7 legacy Save gate needs a separately reviewed final-body hash (NULL).
-- Both reviewed before/after fingerprints are required for idempotency and
-- fresh chronological chains where the existing 13-routine hotfix runs later.
-- Version, migration ledger entry and full-chain rehearsal remain unassigned.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $draft$ begin
 raise exception 'DRAFT: not authorized or compiled; review and seal final catalog before generating an executable forward migration';
end $draft$;
do $forward$
declare target record; routine oid; old_body text; old_definition text; new_body text;
 before_row jsonb; after_row jsonb; matches integer; changed integer:=0; verified integer:=0; observed_hash text;
 pattern text:=$pattern$(errcode[[:space:]]*=[[:space:]]*)'40001'$pattern$;
begin
 if to_regprocedure('public.read_budget_metadata_snapshot_v10(uuid,uuid)') is null
  or to_regprocedure('public.delete_itinerary_item_budget_safe(uuid,uuid)') is null then
  raise exception 'Complete B7 chain required before this forward repair';end if;
 if coalesce((select enabled from app_private.budget_metadata_protocol),true)
  or coalesce((select enabled or activated from app_private.budget_finance_protocol),true)
  or coalesce((select enabled from app_private.budget_payment_protocol),true)
  or coalesce((select enabled from app_private.budget_source_protocol),true)
  or coalesce((select enabled or activated from app_private.budget_receipt_protocol),true)
  or coalesce((select enabled or activated from app_private.budget_lifecycle_protocol),true)
  or coalesce((select enabled or full_enabled from app_private.budget_metadata_undo_protocol),true) then
  raise exception 'Dormant install only; no flag changes are performed';end if;
 for target in select * from (values
  ('app_private.assert_budget_metadata_effect_finished()',1,'34bc147cc37462a09f30fb3f61748bee7d2e0e8196d1f6ebd51e0cf0ca9bd20f','71244bf2cd6b5c3444788c78d9510802d2e9d38e84e3ca7be2702450abebad13'),
  ('app_private.assert_budget_metadata_undo_finished()',1,'346a3cfe12bd9e9e98aaf58dd5fae786d1ca8b234094b0f87accec5f04cfa4e7','74f87457b555a494472dd931cb3784597fe02d659be40a321bc22dc8c0873b26'),
  ('app_private.budget_field_admission(uuid,text,uuid,text,uuid,uuid,text,bigint,bigint,bigint,boolean,jsonb)',2,'df99d2e4d5a67b9f5b8490213f45b52110c7301cfae6c01a502a3f48b55c1fa4','51707bef63fde8a5ee724d3cf01150b1a34028b102f604e8fa8c221ba65caa98'),
  ('app_private.budget_metadata_admission(uuid,text,uuid,text,uuid,uuid,text,bigint,bigint,bigint,boolean)',2,'7837b5d898eda94335f1f526dfeeb3470c83263c87ac3ad18b645efcc47819dc','a0fe39acdee70c5c8fa33d4b61cebb37dd1a6da44c8970f8a2b836abe615f0b0'),
  ('app_private.budget_payment_admission_v2(uuid,text,uuid,uuid,uuid,text,bigint,bigint,jsonb,text)',2,'8fbd53bfdeb4918f936297b479ff9ffe0c9bc0d536228958c116626a356387f7','f7bcad63f45c2f94cbd2075c4452f5a1c3a4c48fd245565fd2c3594418213be2'),
  ('app_private.budget_pricing_admission(uuid,text,uuid,text,uuid,uuid,text,bigint,bigint,bigint,boolean)',2,'a7d9bf7486bf136e4e64390dd8a9ec2159f1cab01a8536ceade1a40c0ed5fb63','5e2a305d48192f9def39cad1c1f61c104f8f3d39db430a83b24726c4c1b37eff'),
  ('app_private.budget_rates_admission(uuid,uuid,uuid,text,bigint,bigint,jsonb,jsonb)',2,'5f0edd0c690e625e30b0a97a3b14aa632ddbbf818a1c3e57aa35d70f91565aa9','c7c23c35570f95ffba3fc8a60c791d15b2af9569676a4649ce078135fd24cd52'),
  ('app_private.budget_source_admission(uuid,text,uuid,uuid,uuid,text,bigint,bigint,jsonb,jsonb)',5,'6b0ecb28028ad1f3e395fa7a79152fd67ff912631816aa43d8f106670c93c945','bfc4a4a8b1d4df08c347b238764d07b2892a1f86be4900d8008724f7b8266165'),
  ('app_private.finish_budget_field()',1,'9d940bc6fb2051aa8d831a4a57116225b561bdfd9040096995330ea176331c32','9e624f101b7a5163a707ddeb259cc0495918ae4a2f88905a73fd31115798b2e7'),
  ('app_private.finish_budget_lifecycle()',2,'ef53c7f9d7adecdd65e5219ec56235648c80303de65d60b21b19a263a24ba0d8','2d36a1870cb7aa86f8049a648d66f2b7adf9f60b7a49ee38394502502f904efe'),
  ('app_private.finish_budget_metadata_patch()',1,'76a4c98b31e930e6baddf2b2f097d8a02d639973c9fa9854e6d1ef201a868167','10ff3fd2face7b6afabdd92c3615ff2fdef0fe3378fe31ad8164463cb45258f4'),
  ('app_private.finish_budget_payment()',2,'f76c8451c5ee0f4becedd817d3bfb67ea74b369ba1f47d329c30a45568bcfaa1','ce8ed4085eebc9a6245d532b1b7dd2036b0965601ff402a5f10167d3dbcd0625'),
  ('app_private.finish_budget_pricing_patch()',1,'5320042e420fc64780970aa8be0197c8426a0c5812dd941bdcef580d21efcf68','ac4c4563e42e6f384143963d0e4d20145cf3e3ac26af031aa4f6390f102d9d92'),
  ('app_private.finish_budget_rates()',3,'04e860d99441b26b362388f09c76cfb20855ac1850382f23771a6a3182216153','8b86e3b605c3245c79e5b8dfbee9bf5b6e0855b4d170783aa8444e99aad8040d'),
  ('app_private.finish_budget_source()',2,'2cd8673357e2af20b38d0d9466e822c44e2cf1fcf02c26c8301d0d8f91d6bbaf','bd02012b983cec888249daf83db29416e83543bc01f139bd24eb7e399249ee86'),
  ('app_private.finish_receipt()',1,'5d76fc63e2178c4fb0cfda307147fce86cdfa01393cf29a7bf103202507e2de4','00ee0a68bfd59602dcd4478332f67b7030a1d73fbb9878a3468afeb6ecd6ff81'),
  ('app_private.finish_workspace_inverse(uuid,uuid,uuid,uuid)',4,'9af52a36b066e755239cfbe099d5361e0192e1dfa280f4fc4f93187bb4e32068','81444af42cde4c7df20f00415d222e4a5479c83671546131d3b688602ce4eff7'),
  ('app_private.lifecycle_admission(uuid,text,uuid,uuid,uuid,text,bigint,bigint,jsonb,jsonb)',1,'fc4e406deb7031b2859091ae67be9fcb7e5308eadb3cf0f78036175b1ffa0bfb','379aa891881d5c8063eb400134b0fd2d7825f51da5752376960834838e22f106'),
  ('app_private.lock_budget_field_parents(uuid,jsonb)',1,'a6a24707c1820434c347b1882a8668a045cd36cbf3a247f31d01b52e3df6165a','da705e54b8c0d4d6bf21dc04d5f9ecff82132b20b864ee5d768fdf3b69756f16'),
  ('app_private.prepare_budget_field(uuid,text,uuid,text,bigint,uuid,uuid,bigint,jsonb,uuid,jsonb)',1,'19b660c16c9b5276543392a63749810dbb9e77c9e4b8a2912ff1298cc6677719','0f3bac238e5ff45e8bc0eff973a4a56b8ef90e2d7d9792a5c752b6341ba6e1d3'),
  ('app_private.prepare_budget_lifecycle(uuid,text,uuid,uuid,uuid,bigint,bigint,jsonb,uuid)',2,'59a8dc37bb429121c7e14df4b9592e78704cc442036ffe7f92620144d15a6700','4a048aecf009ce194f53ceba1915e11a3a98c701b2040f563768c882423cd9aa'),
  ('app_private.prepare_budget_metadata_patch(uuid,text,uuid,text,bigint,uuid,uuid,bigint,jsonb,uuid)',1,'771ab2849eac54a4804daeacaa612997d69482fa46da95a3aa3dda06af5971eb','6d9982e9169566709b09e4393008b7aea4571cc7f71f68419676529111e7f0d1'),
  ('app_private.prepare_budget_metadata_undo(uuid,uuid,uuid,uuid)',2,'af18ef9e332231b6dc3fd7703129d30c2c810ee36ad18d983f5df2b2898166d8','f4672f96c7e02b906b2e7df3043c20d64c7126806db4d564f9279d029c99605b'),
  ('app_private.prepare_budget_payment(uuid,text,uuid,uuid,uuid,bigint,bigint,jsonb,uuid)',3,'1bfe84ceb5c5eb75ad2334749fecca823abd595d2b03dbc1ab40c9bedbebc280','a5bdf7dcacbb3ddff33cf259693fc393b142a17f8c2b7a36029ded433379523c'),
  ('app_private.prepare_budget_pricing_patch(uuid,text,uuid,text,bigint,uuid,uuid,bigint,jsonb,uuid)',5,'a38a91560720beda9130fc01dcbb8221d9f28d15da0d32beae297042d8ee11ce','a1a584d4c7402f1f215d5f9ba948e8b89c88dca9a2e6caebfdad29167b41f282'),
  ('app_private.prepare_budget_rates(uuid,uuid,uuid,bigint,bigint,jsonb,uuid)',2,'03be8c05c546f794abd3b705cd2dfb935c8d7003d8c81f1df3e00fb32290e1d4','60ef5ece9787c856c2ad45bcc7a8f47b3d461ec8b02c0e798530a2b232b55da6'),
  ('app_private.prepare_receipt(uuid,uuid,uuid,uuid,bigint,bigint,jsonb,uuid,text)',4,'21077f5bb167b1aa477526d4d0a062977c0d681b47c18c4db6adff0a5e9ffe88','77d3d6caa3b638df03361d845bd2396f5891c7217b088b17109090700d8ddcf3'),
  ('app_private.receipt_admission(uuid,text,uuid,uuid,uuid,text,bigint,bigint,jsonb)',1,'19f20f4395841705c9fb3936f583ccb91c5a1825a723fed743918cd7b3765a7d','f4657021b2c1c3ed0ad1c9dbfc18b37a9910cfed4d892d6df8d6e644714865dc'),
  ('app_private.receipt_authority(uuid,uuid,uuid,uuid,bigint,bigint,jsonb)',3,'23ed70e3c00dc3f3aa02eef8aac7c4edfd98b785e0509ddcbdad08edafe0e9eb','e9e93248d99ae6cce0dc5e1d099af90c3b36d357f79ea310bf3e82e5de3c8c7d'),
  ('app_private.reconcile_budget_readiness(text,uuid)',1,'61daa8aba6b1feb3066ced4c97e21ca1dbb2a5f03caf17b7dd9cfc651780307c','72d3f8c0fe77cccdcd75a08841a7149abb95ac7a2774d5aa32d0bab2bbbd9d79'),
  ('app_private.record_budget_metadata_undo()',3,'48158f5f52c3f67a4686b50ec6c0b9e460262e4f5a9e391cd6bfbdbe709a6f7f','ccf74600fa79e7375ed06c72bdaf710d3951e9114c16ddaf20e4c2d596402d03'),
  ('app_private.workspace_inverse_manifest()',2,'f1339103161079ca8f77fb66156ffc15b781c57710da47bfd4b98ec59fbc51de','37cd6a53e3ab428d4af5140b7a12eca7163ea9157692f8111938ee15dd3e168b'),
  ('app_private.workspace_undo_top(uuid,uuid,uuid)',5,'3d1ec6e96683ebd25cd5c70b6258291e0d84758cad52e913c2d3c1267e6e0a79','f156820a0da2625624da1d83f684c2a666b1a9805684d43d0916cd23701a7844'),
  ('public.delete_itinerary_item_budget_safe(uuid,uuid)',1,'58d2f85bf17847b68449138183151a3d8fe599af59efb068de162e4139dc1043','4c2c7e5f7b548f96647b67292bc6b30cf5204adc8a3f213140e521303d3fc2be'),
  ('public.patch_budget_metadata_group_v2(uuid,text,uuid,text,bigint,uuid,uuid,bigint,jsonb,uuid,jsonb)',1,'e82b4db4ff60c8fcfabb0d11161f108623c1e6af93f57ad4e05d6002fbb78125','a4b77b82da75fd36a0b51bccfa29374ed682fc59508aeab0a5d4d43bb84ee9b2'),
  ('public.patch_budget_metadata_group(uuid,text,uuid,text,bigint,uuid,uuid,bigint,jsonb,uuid)',1,'ed9fbf65da49ca228d93f38b72b5b4924a9ba5065816cf3036e6e74b24a26834','ace1afd5982d4787b0c2e2593b8e7fc3e3ab63cfe5d6fa7721ef83d833e6b4c0'),
  ('public.save_budget_workspace_record(uuid,text,uuid,timestamptz,jsonb)',3,null,null),
  ('public.undo_budget_workspace(uuid,uuid,uuid,uuid,bigint,uuid)',1,'a2504d57f6f11d7d3095e045c19f780be31d5fa180715e20e4056ddbf8c4654a','3d7440821dabd5b3571f1937235643f94d6dd67db62f5847a0a15b96b415d0b7')
 ) reviewed(signature,expected_sites,reviewed_sha256,mapped_sha256) loop
  routine:=to_regprocedure(target.signature);
  if routine is null or target.reviewed_sha256 is null or target.mapped_sha256 is null then
   raise exception 'Missing routine or unsealed compiled body: %',target.signature;end if;
  select to_jsonb(p),p.prosrc,pg_get_functiondef(p.oid) into before_row,old_body,old_definition from pg_proc p where p.oid=routine;
  observed_hash:=encode(sha256(convert_to(replace(old_body,chr(13),''),'UTF8')),'hex');
  verified:=verified+1;
  -- Supports an already mapped fresh-chain hotfix and a repeated application.
  if observed_hash=target.mapped_sha256 then continue;end if;
  if observed_hash<>target.reviewed_sha256 then
   raise exception 'Unexpected function-body drift: %',target.signature;end if;
  select count(*) into matches from regexp_matches(old_body,pattern,'gi');
  if matches<>target.expected_sites then raise exception 'Unreviewed RAISE count: %',target.signature;end if;
  new_body:=regexp_replace(old_body,pattern,$replacement$\1'PT409'$replacement$,'gi');
  if new_body=old_body or position(old_body in old_definition)=0 then raise exception 'Unexpected source shape';end if;
  execute replace(old_definition,old_body,new_body);
  select to_jsonb(p) into after_row from pg_proc p where p.oid=routine;
  if after_row->>'prosrc'<>new_body or (before_row-'prosrc') is distinct from (after_row-'prosrc') then
   raise exception 'Routine identity, owner, ACL, settings or security changed';end if;
  changed:=changed+1;
 end loop;
 if verified<>38 then raise exception 'Unexpected reviewed routine count';end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in('public','app_private') and p.prosrc ~* pattern) then
  raise exception 'Unknown custom 40001 remains; fail closed rather than broaden the allowlist';end if;
end $forward$;
-- A future executable packet must also verify all original public/Auth/Storage
-- data/ACL/trigger fingerprints and flags, then register exact reviewed source
-- and commit together. This draft never marks a migration applied.
rollback;
