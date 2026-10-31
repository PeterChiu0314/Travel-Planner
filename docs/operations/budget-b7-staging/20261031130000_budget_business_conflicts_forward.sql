-- Reviewed terminal forward; generated from compiled final B7 functions.
-- NON-AUTO-APPLY: kept outside supabase/migrations. No Hosted authorization.
-- 38 routines / 78 sites: 54 business PT409; 24 internal-integrity PT500.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
do $forward$
declare target record; routine oid; old_body text; old_def text; mapped text;
 before_row jsonb; after_row jsonb; observed text; n integer; site integer; verified integer:=0; changed integer:=0;
 pattern text:=$pattern$(errcode[[:space:]]*=[[:space:]]*)'40001'$pattern$;
begin
 if to_regprocedure('public.read_budget_metadata_snapshot_v10(uuid,uuid)') is null
  or to_regprocedure('public.delete_itinerary_item_budget_safe(uuid,uuid)') is null then raise exception 'Complete B7 chain required';end if;
 if coalesce((select enabled from app_private.budget_metadata_protocol),true)
  or coalesce((select enabled or activated from app_private.budget_finance_protocol),true)
  or coalesce((select enabled from app_private.budget_payment_protocol),true)
  or coalesce((select enabled from app_private.budget_source_protocol),true)
  or coalesce((select enabled or activated from app_private.budget_receipt_protocol),true)
  or coalesce((select enabled or activated from app_private.budget_lifecycle_protocol),true)
  or coalesce((select enabled or full_enabled from app_private.budget_metadata_undo_protocol),true) then raise exception 'Dormant-only forward; enabled or latched protocol found';end if;
 -- Each known routine must match an exact compiled before/after fingerprint,
 -- including the final dynamic guard. Unknown custom raises abort the entire
 -- transaction at the final catalog check, rolling back every earlier rewrite.
 for target in select * from (values
 ('app_private.assert_budget_metadata_effect_finished()','34bc147cc37462a09f30fb3f61748bee7d2e0e8196d1f6ebd51e0cf0ca9bd20f','8989115e07f6da60ca6f747bffb8ffe3f72c00141d951f5c198c5b3789a709b6',array['PT500']),
 ('app_private.assert_budget_metadata_undo_finished()','346a3cfe12bd9e9e98aaf58dd5fae786d1ca8b234094b0f87accec5f04cfa4e7','dad3f343185fbd781d1759da2c3e76397945d11e6bf2834fcd7bd15e45416942',array['PT500']),
 ('app_private.budget_field_admission(uuid,text,uuid,text,uuid,uuid,text,bigint,bigint,bigint,boolean,jsonb)','df99d2e4d5a67b9f5b8490213f45b52110c7301cfae6c01a502a3f48b55c1fa4','51707bef63fde8a5ee724d3cf01150b1a34028b102f604e8fa8c221ba65caa98',array['PT409','PT409']),
 ('app_private.budget_metadata_admission(uuid,text,uuid,text,uuid,uuid,text,bigint,bigint,bigint,boolean)','7837b5d898eda94335f1f526dfeeb3470c83263c87ac3ad18b645efcc47819dc','a0fe39acdee70c5c8fa33d4b61cebb37dd1a6da44c8970f8a2b836abe615f0b0',array['PT409','PT409']),
 ('app_private.budget_payment_admission_v2(uuid,text,uuid,uuid,uuid,text,bigint,bigint,jsonb,text)','8fbd53bfdeb4918f936297b479ff9ffe0c9bc0d536228958c116626a356387f7','f7bcad63f45c2f94cbd2075c4452f5a1c3a4c48fd245565fd2c3594418213be2',array['PT409','PT409']),
 ('app_private.budget_pricing_admission(uuid,text,uuid,text,uuid,uuid,text,bigint,bigint,bigint,boolean)','a7d9bf7486bf136e4e64390dd8a9ec2159f1cab01a8536ceade1a40c0ed5fb63','5e2a305d48192f9def39cad1c1f61c104f8f3d39db430a83b24726c4c1b37eff',array['PT409','PT409']),
 ('app_private.budget_rates_admission(uuid,uuid,uuid,text,bigint,bigint,jsonb,jsonb)','5f0edd0c690e625e30b0a97a3b14aa632ddbbf818a1c3e57aa35d70f91565aa9','c7c23c35570f95ffba3fc8a60c791d15b2af9569676a4649ce078135fd24cd52',array['PT409','PT409']),
 ('app_private.budget_source_admission(uuid,text,uuid,uuid,uuid,text,bigint,bigint,jsonb,jsonb)','6b0ecb28028ad1f3e395fa7a79152fd67ff912631816aa43d8f106670c93c945','bfc4a4a8b1d4df08c347b238764d07b2892a1f86be4900d8008724f7b8266165',array['PT409','PT409','PT409','PT409','PT409']),
 ('app_private.finish_budget_field()','9d940bc6fb2051aa8d831a4a57116225b561bdfd9040096995330ea176331c32','bb089f6fca11a6a107e8097a07ce88ceead6e423f19075933fa29574ab76bd4c',array['PT500']),
 ('app_private.finish_budget_lifecycle()','ef53c7f9d7adecdd65e5219ec56235648c80303de65d60b21b19a263a24ba0d8','0183307a30cb21966d58c0d17d1d913e88e351647b7f57057fef43d89d811e05',array['PT500','PT500']),
 ('app_private.finish_budget_metadata_patch()','76a4c98b31e930e6baddf2b2f097d8a02d639973c9fa9854e6d1ef201a868167','f60530a2a2c98d8752f79a0f2f24be2ac112af28e88e9ff66ee95133276ae396',array['PT500']),
 ('app_private.finish_budget_payment()','f76c8451c5ee0f4becedd817d3bfb67ea74b369ba1f47d329c30a45568bcfaa1','748387cce14c3b2c9fd56ff36ecae688b4919b6bfc6faf2bee98be7e415a257e',array['PT500','PT500']),
 ('app_private.finish_budget_pricing_patch()','5320042e420fc64780970aa8be0197c8426a0c5812dd941bdcef580d21efcf68','8ccaeb5bb00737e4dab7b0d40f18c05d4257d25ce1b88156cf4a213b4e63f6bb',array['PT500']),
 ('app_private.finish_budget_rates()','04e860d99441b26b362388f09c76cfb20855ac1850382f23771a6a3182216153','bf6344e34ce4ab1b9516cb7547925052759d4aabc7ef545164b1fce5b618bb19',array['PT500','PT500','PT500']),
 ('app_private.finish_budget_source()','2cd8673357e2af20b38d0d9466e822c44e2cf1fcf02c26c8301d0d8f91d6bbaf','19a6c07798e9f3a8f922cab4ca0e1d3032d0a587b675a39416e586b1e9a38d1d',array['PT500','PT500']),
 ('app_private.finish_receipt()','5d76fc63e2178c4fb0cfda307147fce86cdfa01393cf29a7bf103202507e2de4','ff898589f18b01ada15e60665803514c88526ce2ca02bd7cc3f146a74e4cf74b',array['PT500']),
 ('app_private.finish_workspace_inverse(uuid,uuid,uuid,uuid)','9af52a36b066e755239cfbe099d5361e0192e1dfa280f4fc4f93187bb4e32068','fff03ef9c3c6b28645cd9504c3f63f8165d9512ceef3deb69dea3aaa70e9b713',array['PT500','PT500','PT500','PT500']),
 ('app_private.lifecycle_admission(uuid,text,uuid,uuid,uuid,text,bigint,bigint,jsonb,jsonb)','fc4e406deb7031b2859091ae67be9fcb7e5308eadb3cf0f78036175b1ffa0bfb','379aa891881d5c8063eb400134b0fd2d7825f51da5752376960834838e22f106',array['PT409']),
 ('app_private.lock_budget_field_parents(uuid,jsonb)','a6a24707c1820434c347b1882a8668a045cd36cbf3a247f31d01b52e3df6165a','da705e54b8c0d4d6bf21dc04d5f9ecff82132b20b864ee5d768fdf3b69756f16',array['PT409']),
 ('app_private.prepare_budget_field(uuid,text,uuid,text,bigint,uuid,uuid,bigint,jsonb,uuid,jsonb)','19b660c16c9b5276543392a63749810dbb9e77c9e4b8a2912ff1298cc6677719','0f3bac238e5ff45e8bc0eff973a4a56b8ef90e2d7d9792a5c752b6341ba6e1d3',array['PT409']),
 ('app_private.prepare_budget_lifecycle(uuid,text,uuid,uuid,uuid,bigint,bigint,jsonb,uuid)','59a8dc37bb429121c7e14df4b9592e78704cc442036ffe7f92620144d15a6700','4a048aecf009ce194f53ceba1915e11a3a98c701b2040f563768c882423cd9aa',array['PT409','PT409']),
 ('app_private.prepare_budget_metadata_patch(uuid,text,uuid,text,bigint,uuid,uuid,bigint,jsonb,uuid)','771ab2849eac54a4804daeacaa612997d69482fa46da95a3aa3dda06af5971eb','6d9982e9169566709b09e4393008b7aea4571cc7f71f68419676529111e7f0d1',array['PT409']),
 ('app_private.prepare_budget_metadata_undo(uuid,uuid,uuid,uuid)','af18ef9e332231b6dc3fd7703129d30c2c810ee36ad18d983f5df2b2898166d8','f4672f96c7e02b906b2e7df3043c20d64c7126806db4d564f9279d029c99605b',array['PT409','PT409']),
 ('app_private.prepare_budget_payment(uuid,text,uuid,uuid,uuid,bigint,bigint,jsonb,uuid)','1bfe84ceb5c5eb75ad2334749fecca823abd595d2b03dbc1ab40c9bedbebc280','a5bdf7dcacbb3ddff33cf259693fc393b142a17f8c2b7a36029ded433379523c',array['PT409','PT409','PT409']),
 ('app_private.prepare_budget_pricing_patch(uuid,text,uuid,text,bigint,uuid,uuid,bigint,jsonb,uuid)','a38a91560720beda9130fc01dcbb8221d9f28d15da0d32beae297042d8ee11ce','a1a584d4c7402f1f215d5f9ba948e8b89c88dca9a2e6caebfdad29167b41f282',array['PT409','PT409','PT409','PT409','PT409']),
 ('app_private.prepare_budget_rates(uuid,uuid,uuid,bigint,bigint,jsonb,uuid)','03be8c05c546f794abd3b705cd2dfb935c8d7003d8c81f1df3e00fb32290e1d4','60ef5ece9787c856c2ad45bcc7a8f47b3d461ec8b02c0e798530a2b232b55da6',array['PT409','PT409']),
 ('app_private.prepare_receipt(uuid,uuid,uuid,uuid,bigint,bigint,jsonb,uuid,text)','21077f5bb167b1aa477526d4d0a062977c0d681b47c18c4db6adff0a5e9ffe88','77d3d6caa3b638df03361d845bd2396f5891c7217b088b17109090700d8ddcf3',array['PT409','PT409','PT409','PT409']),
 ('app_private.receipt_admission(uuid,text,uuid,uuid,uuid,text,bigint,bigint,jsonb)','19f20f4395841705c9fb3936f583ccb91c5a1825a723fed743918cd7b3765a7d','f4657021b2c1c3ed0ad1c9dbfc18b37a9910cfed4d892d6df8d6e644714865dc',array['PT409']),
 ('app_private.receipt_authority(uuid,uuid,uuid,uuid,bigint,bigint,jsonb)','23ed70e3c00dc3f3aa02eef8aac7c4edfd98b785e0509ddcbdad08edafe0e9eb','e9e93248d99ae6cce0dc5e1d099af90c3b36d357f79ea310bf3e82e5de3c8c7d',array['PT409','PT409','PT409']),
 ('app_private.reconcile_budget_readiness(text,uuid)','61daa8aba6b1feb3066ced4c97e21ca1dbb2a5f03caf17b7dd9cfc651780307c','ccfb54792a451dd5ee8a35816e48801a5f995885e34e38907586514e2d703a9a',array['PT500']),
 ('app_private.record_budget_metadata_undo()','48158f5f52c3f67a4686b50ec6c0b9e460262e4f5a9e391cd6bfbdbe709a6f7f','5830ee20eb1be97551dfff230cd9fa294b706fb42ac8d4c0c6e97eac9024e041',array['PT500','PT500','PT500']),
 ('app_private.workspace_inverse_manifest()','f1339103161079ca8f77fb66156ffc15b781c57710da47bfd4b98ec59fbc51de','24738db574851c7d952ea77434d73f41d1baedb5700da073f5bba7d824695acc',array['PT500','PT409']),
 ('app_private.workspace_undo_top(uuid,uuid,uuid)','3d1ec6e96683ebd25cd5c70b6258291e0d84758cad52e913c2d3c1267e6e0a79','f156820a0da2625624da1d83f684c2a666b1a9805684d43d0916cd23701a7844',array['PT409','PT409','PT409','PT409','PT409']),
 ('public.delete_itinerary_item_budget_safe(uuid,uuid)','58d2f85bf17847b68449138183151a3d8fe599af59efb068de162e4139dc1043','4c2c7e5f7b548f96647b67292bc6b30cf5204adc8a3f213140e521303d3fc2be',array['PT409']),
 ('public.patch_budget_metadata_group_v2(uuid,text,uuid,text,bigint,uuid,uuid,bigint,jsonb,uuid,jsonb)','e82b4db4ff60c8fcfabb0d11161f108623c1e6af93f57ad4e05d6002fbb78125','a4b77b82da75fd36a0b51bccfa29374ed682fc59508aeab0a5d4d43bb84ee9b2',array['PT409']),
 ('public.patch_budget_metadata_group(uuid,text,uuid,text,bigint,uuid,uuid,bigint,jsonb,uuid)','ed9fbf65da49ca228d93f38b72b5b4924a9ba5065816cf3036e6e74b24a26834','ace1afd5982d4787b0c2e2593b8e7fc3e3ab63cfe5d6fa7721ef83d833e6b4c0',array['PT409']),
 ('public.save_budget_workspace_record(uuid,text,uuid,timestamptz,jsonb)','0335fdea13b507d17c67fb7161bc568b19b2bb6b12beb0186020b8c6f1e07646','bfe5d4bf86080ae678b56ccd6b875e15d52a7ad8ccff1339b8162ea9a8c0ea0a',array['PT409','PT409','PT409']),
 ('public.undo_budget_workspace(uuid,uuid,uuid,uuid,bigint,uuid)','a2504d57f6f11d7d3095e045c19f780be31d5fa180715e20e4056ddbf8c4654a','3d7440821dabd5b3571f1937235643f94d6dd67db62f5847a0a15b96b415d0b7',array['PT409'])
 ) reviewed(signature,before_hash,after_hash,codes) loop
  routine:=to_regprocedure(target.signature);if routine is null then raise exception 'Missing reviewed routine: %',target.signature;end if;
  select to_jsonb(p),p.prosrc,pg_get_functiondef(p.oid) into before_row,old_body,old_def from pg_proc p where p.oid=routine;
  observed:=encode(sha256(convert_to(replace(old_body,chr(13),''),'UTF8')),'hex');verified:=verified+1;
  if observed=target.after_hash then continue;end if;
  if observed<>target.before_hash then raise exception 'Function hash drift: %',target.signature;end if;
  select count(*) into n from regexp_matches(old_body,pattern,'gi');if n<>cardinality(target.codes) then raise exception 'RAISE count drift: %',target.signature;end if;
  mapped:=old_body;
  for site in reverse n..1 loop mapped:=regexp_replace(mapped,pattern,'\1'||quote_literal(target.codes[site]),1,site,'i');end loop;
  if encode(sha256(convert_to(replace(mapped,chr(13),''),'UTF8')),'hex')<>target.after_hash then raise exception 'Mapped body does not match classified seal';end if;
  if position(old_body in old_def)=0 then raise exception 'Unknown function source shape';end if;
  execute replace(old_def,old_body,mapped);
  select to_jsonb(p) into after_row from pg_proc p where p.oid=routine;
  if after_row->>'prosrc'<>mapped or (before_row-'prosrc') is distinct from (after_row-'prosrc') then raise exception 'Routine identity owner ACL security or settings changed';end if;
  changed:=changed+1;
 end loop;
 if verified<>38 then raise exception 'Incomplete reviewed catalog';end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','app_private') and p.prosrc ~* pattern) then raise exception 'Unknown custom 40001 remains';end if;
 raise notice 'B7 forward verified % routines; changed %',verified,changed;
end $forward$;
commit;
