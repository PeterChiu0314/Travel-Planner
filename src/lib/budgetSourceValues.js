const version = n => Number.isSafeInteger(n) && n >= 0;
const nullableId = id => id === null || typeof id === 'string' && Boolean(id);
const key = t => `${t?.kind}:${t?.id}:${t?.group}`;
export const sourceSignature = value => JSON.stringify(value, function(k,v) { return v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))) : v; });
export const sameSourceValue = (a,b) => a?.budget_id === b?.budget_id && a?.origin_id === b?.origin_id && a?.payment_origin === b?.payment_origin;
export const validSourceValue = v => v && nullableId(v.budget_id) && nullableId(v.origin_id) && ['manual','budget_toggle'].includes(v.payment_origin);
export const validSourceVersions = v => v && version(v.rates) && version(v.members) && Array.isArray(v.checks) && v.checks.length>0
 && new Set(v.checks.map(key)).size===v.checks.length && v.checks.every(t=>t && ['actual','budget'].includes(t.kind) && typeof t.id==='string' && ['source','payment','pricing','payer','title','category','note'].includes(t.group) && version(t.revision) && version(t.graph))
 && Array.isArray(v.retained) && v.retained.every(r=>typeof r.budget_id==='string' && Array.isArray(r.actuals) && r.actuals.every(a=>typeof a.id==='string' && nullableId(a.current) && nullableId(a.origin) && ['manual','budget_toggle'].includes(a.provenance)));
export function validSourceSnapshot(data) {
 return data.sourceProtocol?.name==='budget-source' && data.sourceProtocol.schemaVersion===1 && typeof data.sourceProtocol.enabled==='boolean'
  && Array.isArray(data.sourceRecords) && data.sourceRecords.length===data.actualExpenses.length && new Set(data.sourceRecords.map(r=>r?.id)).size===data.sourceRecords.length
  && data.sourceRecords.every(r=>{const a=data.actualExpenses.find(a=>a.id===r?.id);return a && r.kind==='actual' && r.trip_id===data.tripId && a.trip_id===data.tripId && version(r.revision) && version(r.epoch) && typeof r.supported==='boolean' && validSourceValue(r.value)
   && sameSourceValue(r.value,{budget_id:a.budget_item_id??null,origin_id:a.budget_origin_id??null,payment_origin:a.payment_origin||'manual'})
   && typeof r.held==='boolean' && typeof r.own_session==='boolean' && (!r.held || typeof r.owner_id==='string' && Number.isFinite(Date.parse(r.expires_at)));});
}
export function validSourcePreview(p,snapshot,id,intent) {
 const r=snapshot?.sourceRecords?.find(r=>r.id===id),before=p?.before,after=p?.after;
 const allowed=['budget_item_id','budget_origin_id',...(intent?.action==='apply_source_data'?['title','category','note','payer_id','amount','unit_amount','currency','exchange_rate','twd_amount','pricing_mode','split_type']:[])];
 return r && p?.kind==='actual' && p.id===id && p.action===intent.action && p.budget_id===(intent.budget_id??null) && p.revision===r.revision
  && before?.id===id && after?.id===id && before.trip_id===snapshot.tripId && after.trip_id===snapshot.tripId
  && sameSourceValue(r.value,{budget_id:before.budget_item_id??null,origin_id:before.budget_origin_id??null,payment_origin:before.payment_origin})
  && Object.keys({...before,...after}).filter(k=>!allowed.includes(k)).every(k=>sourceSignature(before[k])===sourceSignature(after[k]))
  && validSourceVersions(p.versions) && p.versions.checks.some(t=>t.kind==='actual'&&t.id===id&&t.group==='source'&&t.revision===r.revision)
  && Array.isArray(p.targets) && new Set(p.targets.map(key)).size===p.targets.length && p.targets.some(t=>t.kind==='actual'&&t.id===id&&t.group==='source')
  && p.targets.every(t=>t && (t.kind==='actual'&&t.id===id&&['source','title','category','note','payer','pricing'].includes(t.group) || t.kind==='budget'&&t.group==='payment'&&snapshot.budgetItems.some(b=>b.id===t.id)))
  && typeof p.changed==='boolean' && typeof p.topology==='boolean' && Array.isArray(p.groups) && Array.isArray(p.people_before) && Array.isArray(p.people_after);
}
export function validSourceAdmission(data,e) {
 return version(data?.epoch) && sourceSignature(data.intent)===sourceSignature(e.intent) && Array.isArray(data.targets) && new Set(data.targets.map(key)).size===data.targets.length
  && data.targets.length===e.targets.length && data.targets.every(t=>t&&version(t.epoch)&&e.targets.some(x=>key(x)===key(t)))
  && data.targets.some(t=>t.kind==='actual'&&t.id===e.id&&t.group==='source'&&t.epoch===data.epoch);
}
